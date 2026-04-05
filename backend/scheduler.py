from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta, timezone
from .db import supabase
from .notification_service import send_appointment_reminder

scheduler = BackgroundScheduler()


def send_reminders():
    """
    Runs on a schedule. Finds appointments that are 23-25 hours away
    and have not yet received a reminder, then sends the reminder email
    and stamps notification_sent_at.
    """
    now = datetime.utcnow()
    lower_bound = (now + timedelta(hours=23, minutes=59)).isoformat()
    upper_bound = (now + timedelta(hours=24, minutes=1)).isoformat()

    print(f"[Scheduler] Checking reminders at {now.isoformat()}")
    print(f"[Scheduler] Window: {lower_bound} → {upper_bound}")

    try:
        resp = (
            supabase.table("appointments")
            .select("*, patients(name, email)")
            .gte("appointment_datetime", lower_bound)
            .lte("appointment_datetime", upper_bound)
            .is_("notification_sent_at", "null")
            .in_("status", ["scheduled"])
            .execute()
        )

        appointments = resp.data or []
        print(f"[Scheduler] Found {len(appointments)} appointment(s) to remind")

        for appt in appointments:
            patient = appt.get("patients") or {}
            patient_email = patient.get("email")
            patient_name = patient.get("name")

            if not patient_email:
                print(f"[Scheduler] Skipping appointment {appt['id']} — no patient email")
                continue

            appointment_dt = datetime.fromisoformat(
                appt["appointment_datetime"].replace("Z", "+00:00")
            )

            sent = send_appointment_reminder(
                patient_name=patient_name,
                patient_email=patient_email,
                appointment_datetime=appointment_dt,
                notes=appt.get("notes"),
            )

            if sent:
                supabase.table("appointments").update(
                    {"notification_sent_at": datetime.utcnow().isoformat()}
                ).eq("id", appt["id"]).execute()
                print(f"[Scheduler] Reminder sent and stamped for appointment {appt['id']}")
            else:
                print(f"[Scheduler] Failed to send reminder for appointment {appt['id']}")

    except Exception as e:
        print(f"[Scheduler] Error during reminder job: {e}")


def auto_no_show():
    try:
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=30)

        # Find all scheduled appointments where datetime has passed by more than 30 minutes
        result = supabase.table("appointments") \
            .select("id") \
            .eq("status", "scheduled") \
            .lt("appointment_datetime", cutoff.isoformat()) \
            .execute()

        if not result.data:
            return

        for appointment in result.data:
            supabase.table("appointments") \
                .update({"status": "no_show"}) \
                .eq("id", appointment["id"]) \
                .execute()

        print(f"[Scheduler] Marked {len(result.data)} appointment(s) as no_show")

    except Exception as e:
        print(f"[Scheduler] auto_no_show error: {e}")


def start_scheduler():
    scheduler.add_job(
        send_reminders,
        trigger="interval",
        minutes=1,
        id="appointment_reminders",
        replace_existing=True,
    )
    scheduler.add_job(auto_no_show, trigger='interval', minutes=1)
    scheduler.start()
    print("[Scheduler] APScheduler started — reminder job runs every 1 minute")

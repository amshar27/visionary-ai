import os
import resend
from datetime import datetime
import pytz

resend.api_key = os.getenv("RESEND_API_KEY")
KL_TZ = pytz.timezone("Asia/Kuala_Lumpur")


def _format_datetime(dt: datetime) -> str:
    """Convert UTC datetime to KL time, return human-readable string."""
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    kl_time = dt.astimezone(KL_TZ)
    return kl_time.strftime("%A, %d %B %Y at %I:%M %p")


def send_appointment_confirmation(
    patient_name: str,
    patient_email: str,
    appointment_datetime: datetime,
    notes: str | None = None,
) -> bool:
    formatted_dt = _format_datetime(appointment_datetime)

    notes_row = (
        f"""
        <tr>
          <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Notes</td>
          <td style="padding:10px 14px;font-size:14px;">{notes}</td>
        </tr>"""
        if notes is not None
        else ""
    )

    html = f"""
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#2563eb;padding:32px 24px;border-radius:8px 8px 0 0;text-align:center;">
        <p style="color:#bfdbfe;font-size:13px;margin:0 0 4px;">Visionary AI Screening Centre</p>
        <h1 style="color:#ffffff;font-size:22px;margin:0;">Appointment Confirmation</h1>
      </div>
      <div style="background:#ffffff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;color:#111827;">Dear <strong>{patient_name}</strong>,</p>
        <p style="font-size:14px;color:#374151;">Your retinal screening appointment has been successfully booked. Please find your appointment details below.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;">
            <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Date &amp; Time</td>
            <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#2563eb;">{formatted_dt}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Patient</td>
            <td style="padding:10px 14px;font-size:14px;">{patient_name}</td>
          </tr>{notes_row}
        </table>
        <p style="font-size:13px;color:#6b7280;border-top:1px solid #f3f4f6;padding-top:16px;margin-top:8px;">
          Please arrive 10 minutes early. If you need to reschedule, contact the clinic as soon as possible.
        </p>
      </div>
    </div>
    """

    try:
        resend.Emails.send({
            "from": "Visionary AI <onboarding@resend.dev>",
            "to": [patient_email],
            "subject": f"Appointment Confirmed — {formatted_dt}",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[notification_service] Failed to send confirmation to {patient_email}: {e}")
        return False


def send_appointment_reminder(
    patient_name: str,
    patient_email: str,
    appointment_datetime: datetime,
    notes: str | None = None,
) -> bool:
    formatted_dt = _format_datetime(appointment_datetime)

    notes_row = (
        f"""
        <tr>
          <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Notes</td>
          <td style="padding:10px 14px;font-size:14px;">{notes}</td>
        </tr>"""
        if notes is not None
        else ""
    )

    html = f"""
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#7c3aed;padding:32px 24px;border-radius:8px 8px 0 0;text-align:center;">
        <p style="color:#ede9fe;font-size:13px;margin:0 0 4px;">Visionary AI Screening Centre</p>
        <h1 style="color:#ffffff;font-size:22px;margin:0;">Appointment Reminder — Tomorrow</h1>
      </div>
      <div style="background:#ffffff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;color:#111827;">Dear <strong>{patient_name}</strong>,</p>
        <p style="font-size:14px;color:#374151;">This is a friendly reminder that you have a retinal screening appointment tomorrow.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
          <tr style="background:#f9fafb;">
            <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Date &amp; Time</td>
            <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#7c3aed;">{formatted_dt}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-size:14px;">Patient</td>
            <td style="padding:10px 14px;font-size:14px;">{patient_name}</td>
          </tr>{notes_row}
        </table>
        <p style="font-size:13px;color:#6b7280;border-top:1px solid #f3f4f6;padding-top:16px;margin-top:8px;">
          Please arrive 10 minutes early. If you need to reschedule, contact the clinic as soon as possible.
        </p>
      </div>
    </div>
    """

    try:
        resend.Emails.send({
            "from": "Visionary AI <onboarding@resend.dev>",
            "to": [patient_email],
            "subject": f"Reminder: Your Appointment Tomorrow — {formatted_dt}",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[notification_service] Failed to send reminder to {patient_email}: {e}")
        return False


def send_clinical_report(
    patient_name: str,
    patient_email: str,
    report_html: str,
    session_id: str,
) -> bool:
    html = f"""
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#16a34a;padding:32px 24px;border-radius:8px 8px 0 0;text-align:center;">
        <p style="color:#bbf7d0;font-size:13px;margin:0 0 4px;">Visionary AI Screening Centre</p>
        <h1 style="color:#ffffff;font-size:22px;margin:0;">Your Clinical Report</h1>
      </div>
      <div style="background:#ffffff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
        <p style="font-size:15px;color:#111827;">Dear <strong>{patient_name}</strong>,</p>
        <p style="font-size:14px;color:#374151;">Your diabetic retinopathy screening report has been reviewed and approved by your doctor. Please find the clinical summary below.</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;margin:20px 0;font-size:14px;color:#111827;line-height:1.7;">
          {report_html}
        </div>
        <p style="font-size:12px;color:#6b7280;border-top:1px solid #f3f4f6;padding-top:16px;margin-top:8px;">
          This report is AI-assisted and reviewed by a licensed physician. Session reference: {session_id[:8]}. If you have any questions, please contact your clinic.
        </p>
      </div>
    </div>
    """

    try:
        resend.Emails.send({
            "from": "Visionary AI <onboarding@resend.dev>",
            "to": [patient_email],
            "subject": "Your Clinical Report — Visionary AI",
            "html": html,
        })
        return True
    except Exception as e:
        print(f"[notification_service] Failed to send clinical report to {patient_email}: {e}")
        return False


def send_otp_email(to_email: str, to_name: str, otp_code: str) -> bool:
    """Send OTP code for password reset."""
    try:
        resend.Emails.send({
            "from": "Visionary AI <onboarding@resend.dev>",
            "to": [to_email],
            "subject": "Your Password Reset Code \u2013 Visionary AI",
            "html": f"""
            <div style="font-family: 'Segoe UI', sans-serif; background: #0b0f14; color: #e2e8f0; padding: 40px; border-radius: 12px; max-width: 500px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 32px;">
                <h1 style="color: #60a5fa; font-size: 24px; margin: 0;">Visionary AI</h1>
                <p style="color: #94a3b8; margin-top: 8px;">Password Reset Request</p>
              </div>
              <p style="color: #e2e8f0;">Hello <strong>{to_name}</strong>,</p>
              <p style="color: #94a3b8;">Use the code below to reset your password. This code expires in <strong style="color: #f59e0b;">10 minutes</strong>.</p>
              <div style="background: #1e293b; border: 2px solid #3b82f6; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <span style="font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #60a5fa; font-family: monospace;">{otp_code}</span>
              </div>
              <p style="color: #64748b; font-size: 13px;">If you did not request this, please ignore this email. Your password will not change.</p>
              <hr style="border-color: #1e293b; margin: 24px 0;">
              <p style="color: #475569; font-size: 12px; text-align: center;">Visionary AI — Clinical Eye Screening System</p>
            </div>
            """
        })
        return True
    except Exception as e:
        print(f"[OTP email error] {e}")
        return False

# backend/pdf_service.py
"""
Clinical report PDF generation.

Renders the doctor-reviewed clinical report markdown into a styled PDF using
xhtml2pdf (pisa). Optionally embeds a doctor signature (PNG base64 data URL)
in a certification block at the bottom of the report, just above the footer
disclaimer. xhtml2pdf supports base64 <img> src directly, so the signature
data URL can be dropped straight into the template.
"""

import html
import re
from io import BytesIO

import markdown
from xhtml2pdf import pisa


from datetime import datetime

_DISCLAIMER = (
    "This report is AI-assisted and reviewed by a licensed physician. "
    "It is intended for clinical use and should be interpreted alongside a "
    "full ophthalmic examination. If you have any questions, please contact "
    "your clinic."
)


def _fmt_mc_date(raw: str) -> str:
    """Format a 'YYYY-MM-DD' string as 'DD Month YYYY'; fall back to raw."""
    try:
        return datetime.strptime(str(raw), "%Y-%m-%d").strftime("%d %B %Y")
    except (ValueError, TypeError):
        return str(raw or "")


def _build_signature_block(signature_data_url: str, doctor_name: str = None) -> str:
    """Certification + signature image + reviewing-doctor line."""
    doctor_line = (
        f'<p style="margin:2px 0 0;font-size:13px;color:#111827;">{doctor_name}</p>'
        if doctor_name
        else ""
    )
    return f"""
    <div style="margin-top:36px;">
      <p style="font-size:13px;color:#374151;margin:0 0 8px;">
        I hereby certify that I have reviewed this clinical report.
      </p>
      <img src="{signature_data_url}" style="height:80px;" />
      <div style="border-top:1px solid #111827;width:240px;margin-top:4px;"></div>
      {doctor_line}
      <p style="margin:2px 0 0;font-size:12px;color:#6b7280;">Reviewing Doctor</p>
    </div>
    """


# Physical-examination fields rendered IN THIS ORDER (only non-empty values shown).
_EXAM_FIELDS = [
    ("visual_acuity", "Visual Acuity"),
    ("slit_lamp", "Slit-Lamp"),
    ("iop", "IOP (mmHg)"),
    ("gonioscopy", "Gonioscopy"),
    ("cup_disc", "Cup-to-Disc Ratio"),
    ("visual_field", "Visual Field"),
    ("dilated_fundus", "Dilated Fundus"),
    ("macular_edema", "Macular Edema"),
    ("lens_opacity_type", "Lens Opacity Type"),
    ("lens_density", "Lens Density"),
    ("glare_contrast", "Glare/Contrast"),
]


def _esc(value) -> str:
    """HTML-escape an interpolated value (None -> '')."""
    return html.escape(str(value)) if value is not None else ""


def _is_empty(value) -> bool:
    return value is None or str(value).strip() == ""


def _build_eye_exam_html(eye: dict) -> str:
    """Render one eye's non-empty exam fields as <p> rows."""
    eye = eye or {}
    rows = []
    for key, label in _EXAM_FIELDS:
        val = eye.get(key)
        if not _is_empty(val):
            rows.append(
                f'<p style="margin:0 0 4px;font-size:12px;">'
                f'<strong>{_esc(label)}:</strong> {_esc(val)}</p>'
            )
    return "".join(rows) if rows else '<p style="margin:0;font-size:12px;color:#6b7280;">No findings recorded.</p>'


def _build_assessment_block(
    physical_exam: dict = None,
    prescription: list = None,
    clinical_impression: str = None,
    management_plan: str = None,
    follow_up_interval: str = None,
) -> str:
    """
    Build the "Doctor's Clinical Assessment" section. Returns "" if every part
    is empty. Order: Physical Examination -> Clinical Impression ->
    Management Plan -> Prescription -> Follow-up interval.
    """
    # Nothing supplied at all -> no section.
    if not any([physical_exam, prescription, clinical_impression, management_plan, follow_up_interval]):
        return ""

    parts = []

    # --- Physical Examination (two-column L/R table) ---
    if physical_exam:
        left = physical_exam.get("left") or {}
        right = physical_exam.get("right") or {}
        other = physical_exam.get("other_findings")
        other_html = (
            f'<p style="margin:8px 0 0;font-size:12px;"><strong>Other findings:</strong> {_esc(other)}</p>'
            if not _is_empty(other)
            else ""
        )
        parts.append(f"""
        <h3 style="margin:0 0 8px;">Physical Examination</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
          <tr>
            <th style="width:50%;text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Left Eye</th>
            <th style="width:50%;text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Right Eye</th>
          </tr>
          <tr>
            <td style="border:1px solid #e5e7eb;padding:8px;vertical-align:top;">{_build_eye_exam_html(left)}</td>
            <td style="border:1px solid #e5e7eb;padding:8px;vertical-align:top;">{_build_eye_exam_html(right)}</td>
          </tr>
        </table>
        {other_html}
        """)

    # --- Clinical Impression ---
    if not _is_empty(clinical_impression):
        parts.append(
            f'<p style="margin:12px 0 0;font-size:12px;">'
            f'<strong>Clinical Impression:</strong> {_esc(clinical_impression)}</p>'
        )

    # --- Prescription (table, skipped when empty) ---
    rx_rows = []
    for rx in (prescription or []):
        rx = rx or {}
        if all(_is_empty(rx.get(k)) for k in ("drug", "dose", "frequency", "duration")):
            continue
        rx_rows.append(f"""
          <tr>
            <td style="border:1px solid #e5e7eb;padding:6px;font-size:12px;">{_esc(rx.get("drug"))}</td>
            <td style="border:1px solid #e5e7eb;padding:6px;font-size:12px;">{_esc(rx.get("dose"))}</td>
            <td style="border:1px solid #e5e7eb;padding:6px;font-size:12px;">{_esc(rx.get("frequency"))}</td>
            <td style="border:1px solid #e5e7eb;padding:6px;font-size:12px;">{_esc(rx.get("duration"))}</td>
          </tr>
        """)
    if rx_rows:
        parts.append(f"""
        <h3 style="margin:12px 0 8px;">Prescription</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <th style="text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Drug</th>
            <th style="text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Dose</th>
            <th style="text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Frequency</th>
            <th style="text-align:left;border:1px solid #e5e7eb;background:#f3f4f6;padding:6px;font-size:12px;">Duration</th>
          </tr>
          {''.join(rx_rows)}
        </table>
        """)

    return f"""
    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
      <h2 style="margin:0 0 12px;">Doctor's Clinical Assessment</h2>
      {''.join(parts)}
    </div>
    """


def generate_report_pdf(
    patient_name: str,
    report_markdown: str,
    signature_data_url: str = None,
    doctor_name: str = None,
    physical_exam: dict = None,
    prescription: list = None,
    clinical_impression: str = None,
    management_plan: str = None,
    follow_up_interval: str = None,
) -> bytes:
    """
    Render a clinical report (markdown) to PDF bytes.

    If signature_data_url is provided (format "data:image/png;base64,...."),
    a signature/certification block is added at the bottom of the report,
    before the footer disclaimer.

    If any of the assessment args (physical_exam, prescription,
    clinical_impression, management_plan, follow_up_interval) is truthy, a
    "Doctor's Clinical Assessment" section is inserted after the report body
    and before the signature block.
    """
    # Strip the trailing "Disclaimer" section the CrewAI Writer appends — PDF
    # rendering only. rag_summary in the DB and the on-screen AI Clinical Summary
    # card are unaffected (this acts on a local copy of the markdown string).
    report_markdown = re.sub(
        r'\n#{0,6}\s*Disclaimer\b[\s\S]*$', '', report_markdown or '',
        flags=re.IGNORECASE,
    ).rstrip()

    body_html = markdown.markdown(report_markdown, extensions=["extra"])

    assessment_html = _build_assessment_block(
        physical_exam=physical_exam,
        prescription=prescription,
        clinical_impression=clinical_impression,
        management_plan=management_plan,
        follow_up_interval=follow_up_interval,
    )

    signature_html = (
        _build_signature_block(signature_data_url, doctor_name)
        if signature_data_url
        else ""
    )

    html = f"""
    <html>
      <head>
        <style>
          @page {{
            margin: 2cm 2cm 3cm 2cm;   /* extra BOTTOM margin reserves space for the repeating footer */
            @frame footer_frame {{
              -pdf-frame-content: footerContent;
              left: 2cm; right: 2cm;
              bottom: 1.5cm; height: 1.5cm;
            }}
          }}
          body {{ font-family: Helvetica, Arial, sans-serif; color: #111827; font-size: 12px; line-height: 1.6; }}
          h1, h2, h3 {{ color: #111827; }}
          h1 {{ font-size: 20px; }}
          h2 {{ font-size: 16px; }}
          h3 {{ font-size: 14px; }}
          ul, ol {{ margin: 4px 0 4px 18px; }}
          .header {{ text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }}
          .header .brand {{ color: #2563eb; font-size: 13px; margin: 0 0 4px; }}
          .header .title {{ font-size: 22px; margin: 0; color: #111827; }}
        </style>
      </head>
      <body>
        <div class="header">
          <p class="brand">Hospital Ampang Jaya</p>
          <h1 class="title">Clinical Report &mdash; {patient_name}</h1>
        </div>
        <div class="report-body">
          {body_html}
        </div>
        {assessment_html}
        {signature_html}
        <div id="footerContent">
          <div style="border-top:1px solid #e5e7eb; padding-top:8px; font-size:11px; color:#6b7280; text-align:left;">
            {_DISCLAIMER}
          </div>
        </div>
      </body>
    </html>
    """

    buffer = BytesIO()
    result = pisa.CreatePDF(src=html, dest=buffer)
    if result.err:
        raise RuntimeError("Failed to generate clinical report PDF")
    return buffer.getvalue()


def generate_mc_pdf(
    certificate_no: str,
    mc_date: str,
    patient_name: str,
    ic_passport: str,
    days,
    date_from: str,
    date_to: str,
    reason: str,
    signature_data_url: str = None,
    doctor_name: str = None,
    department: str = None,
) -> bytes:
    """
    Render a bilingual (English / Bahasa Malaysia) Malaysian Medical Certificate
    to PDF bytes. Letterhead "Hospital Ampang Jaya" (name only). No MMC No.

    certificate_no is an already-formatted 5-digit string. mc_date / date_from /
    date_to are 'YYYY-MM-DD' strings (rendered as 'DD Month YYYY', falling back
    to the raw string). Reuses _build_signature_block for the doctor signature.
    """
    mc_date_fmt = _fmt_mc_date(mc_date)
    from_fmt = _fmt_mc_date(date_from)
    to_fmt = _fmt_mc_date(date_to)
    days_str = _esc(days)

    department_row = (
        f'<tr>'
        f'<td style="padding:6px 0;width:40%;color:#374151;">Department / Jabatan</td>'
        f'<td style="padding:6px 0;color:#111827;"><strong>{_esc(department)}</strong></td>'
        f'</tr>'
        if not _is_empty(department)
        else ""
    )

    signature_html = (
        _build_signature_block(signature_data_url, doctor_name)
        if signature_data_url
        else ""
    )

    html_doc = f"""
    <html>
      <head>
        <style>
          @page {{ margin: 2cm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; color: #111827; font-size: 13px; line-height: 1.6; }}
          .header {{ text-align: center; border-bottom: 2px solid #16a34a; padding-bottom: 12px; margin-bottom: 20px; }}
          .header .brand {{ color: #16a34a; font-size: 14px; margin: 0 0 4px; font-weight: bold; }}
          .header .title {{ font-size: 18px; margin: 8px 0 0; color: #111827; letter-spacing: 1px; }}
          table {{ width: 100%; border-collapse: collapse; }}
          .meta td {{ font-size: 13px; }}
          .statement {{ margin: 22px 0; font-size: 13px; }}
          .footer {{ margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #6b7280; }}
        </style>
      </head>
      <body>
        <div class="header">
          <p class="brand">Hospital Ampang Jaya</p>
          <h1 class="title">MEDICAL CERTIFICATE / SIJIL CUTI SAKIT</h1>
        </div>

        <table class="meta">
          <tr>
            <td style="padding:6px 0;width:40%;color:#374151;">Certificate No. / No. Sijil</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(certificate_no)}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;">Date / Tarikh</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(mc_date_fmt)}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;">Patient Name / Nama Pesakit</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(patient_name)}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;">I/C No. / No. K/P</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(ic_passport)}</strong></td>
          </tr>
          {department_row}
        </table>

        <p class="statement">
          This is to certify that the above-named is unfit for duty for
          <strong>{days_str}</strong> day(s).<br/>
          <em>Adalah disahkan bahawa pesakit tersebut tidak sihat untuk bertugas selama
          <strong>{days_str}</strong> hari.</em>
        </p>

        <table class="meta">
          <tr>
            <td style="padding:6px 0;width:40%;color:#374151;">From / Dari</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(from_fmt)}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;">To / Hingga</td>
            <td style="padding:6px 0;color:#111827;"><strong>{_esc(to_fmt)}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#374151;vertical-align:top;">Reason / Sebab</td>
            <td style="padding:6px 0;color:#111827;">{_esc(reason)}</td>
          </tr>
        </table>

        {signature_html}

        <div class="footer">
          This medical certificate is issued by Hospital Ampang Jaya. /
          Sijil cuti sakit ini dikeluarkan oleh Hospital Ampang Jaya.
        </div>
      </body>
    </html>
    """

    buffer = BytesIO()
    result = pisa.CreatePDF(src=html_doc, dest=buffer)
    if result.err:
        raise RuntimeError("Failed to generate medical certificate PDF")
    return buffer.getvalue()

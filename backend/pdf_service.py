# backend/pdf_service.py
"""
Clinical report PDF generation.

Renders the doctor-reviewed clinical report markdown into a styled PDF using
xhtml2pdf (pisa). Optionally embeds a doctor signature (PNG base64 data URL)
in a certification block at the bottom of the report, just above the footer
disclaimer. xhtml2pdf supports base64 <img> src directly, so the signature
data URL can be dropped straight into the template.
"""

from io import BytesIO

import markdown
from xhtml2pdf import pisa


_DISCLAIMER = (
    "This report is AI-assisted and reviewed by a licensed physician. "
    "It is intended for clinical use and should be interpreted alongside a "
    "full ophthalmic examination. If you have any questions, please contact "
    "your clinic."
)


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


def generate_report_pdf(
    patient_name: str,
    report_markdown: str,
    signature_data_url: str = None,
    doctor_name: str = None,
) -> bytes:
    """
    Render a clinical report (markdown) to PDF bytes.

    If signature_data_url is provided (format "data:image/png;base64,...."),
    a signature/certification block is added at the bottom of the report,
    before the footer disclaimer.
    """
    body_html = markdown.markdown(report_markdown or "", extensions=["extra"])

    signature_html = (
        _build_signature_block(signature_data_url, doctor_name)
        if signature_data_url
        else ""
    )

    html = f"""
    <html>
      <head>
        <style>
          @page {{ margin: 2cm; }}
          body {{ font-family: Helvetica, Arial, sans-serif; color: #111827; font-size: 12px; line-height: 1.6; }}
          h1, h2, h3 {{ color: #111827; }}
          h1 {{ font-size: 20px; }}
          h2 {{ font-size: 16px; }}
          h3 {{ font-size: 14px; }}
          ul, ol {{ margin: 4px 0 4px 18px; }}
          .header {{ text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }}
          .header .brand {{ color: #2563eb; font-size: 13px; margin: 0 0 4px; }}
          .header .title {{ font-size: 22px; margin: 0; color: #111827; }}
          .footer {{ margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #6b7280; }}
        </style>
      </head>
      <body>
        <div class="header">
          <p class="brand">Visionary AI Screening Centre</p>
          <h1 class="title">Clinical Report &mdash; {patient_name}</h1>
        </div>
        <div class="report-body">
          {body_html}
        </div>
        {signature_html}
        <div class="footer">
          {_DISCLAIMER}
        </div>
      </body>
    </html>
    """

    buffer = BytesIO()
    result = pisa.CreatePDF(src=html, dest=buffer)
    if result.err:
        raise RuntimeError("Failed to generate clinical report PDF")
    return buffer.getvalue()

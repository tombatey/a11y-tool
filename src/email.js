/**
 * Loops.so transactional email sender.
 * Set LOOPS_API_KEY and LOOPS_SCAN_COMPLETE_TEMPLATE_ID in .env to enable.
 * If either is missing, notifications are silently skipped.
 */

const LOOPS_API       = 'https://app.loops.so/api/v1/transactional';
const APP_URL         = process.env.APP_URL || 'http://localhost:3000';

function isConfigured() {
  return !!(process.env.LOOPS_API_KEY && process.env.LOOPS_SCAN_COMPLETE_TEMPLATE_ID);
}

/**
 * Send a "scan complete" notification to the person who started the scan.
 * Called by the orchestrator after a scan reaches a terminal state.
 *
 * emailData shape:
 *   { toEmail, scanId, status, targetUrl, pagesScanned,
 *     findingsCount, criticalCount, seriousCount, moderateCount, minorCount }
 */
async function sendScanCompleteEmail(emailData) {
  if (!isConfigured())      return;
  if (!emailData?.toEmail)  return;

  const {
    toEmail, scanId, status, targetUrl,
    pagesScanned, findingsCount,
    criticalCount, seriousCount, moderateCount, minorCount,
  } = emailData;

  const viewUrl    = `${APP_URL}/history.html?id=${scanId}`;
  const statusText = status === 'done'    ? 'completed'
                   : status === 'stopped' ? 'stopped early'
                   :                        'finished with errors';

  try {
    const res = await fetch(LOOPS_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
      },
      body: JSON.stringify({
        email:             toEmail,
        transactionalId:   process.env.LOOPS_SCAN_COMPLETE_TEMPLATE_ID,
        dataVariables: {
          targetUrl:     targetUrl    || 'Unknown',
          pagesScanned:  String(pagesScanned  || 0),
          findingsCount: String(findingsCount || 0),
          criticalCount: String(criticalCount || 0),
          seriousCount:  String(seriousCount  || 0),
          moderateCount: String(moderateCount || 0),
          minorCount:    String(minorCount    || 0),
          status:        statusText,
          viewUrl,
        },
      }),
    });

    if (res.ok) {
      console.log(`Scan complete email sent to ${toEmail} (scan ${scanId})`);
    } else {
      const body = await res.text().catch(() => '');
      console.error(`Loops email failed (${res.status}):`, body.slice(0, 200));
    }
  } catch (err) {
    console.error('Failed to send scan complete email:', err.message);
  }
}

module.exports = { sendScanCompleteEmail, isConfigured };

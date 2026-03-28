// ============================================================
// Walk-Up Songs Promo Code Backend -- Google Apps Script
// ============================================================
//
// SETUP INSTRUCTIONS:
//
// 1. Your Google Sheet should have:
//    Column A: Promo code
//    Column B: Redemption URL
//    Column C: Claimed timestamp (left blank, script fills this in)
//    No header row. Codes start at row 1.
//
// 2. Open the Google Sheet, go to Extensions > Apps Script
//
// 3. Delete any existing code and paste this entire file
//
// 4. Click Deploy > New deployment
//    - Type: Web app
//    - Execute as: Me
//    - Who has access: Anyone
//    - Click Deploy
//
// 5. Copy the web app URL and paste it into promo/index.html as SCRIPT_URL
//
// 6. To add more codes later, just paste them into new rows
// ============================================================

function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();

  if (action === 'claim') {
    return claimCode();
  } else if (action === 'status') {
    return getStatus();
  }

  return jsonResponse({ error: 'unknown action' });
}

function claimCode() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var data = sheet.getDataRange().getValues();

    // Find the first unclaimed code (column C is empty)
    for (var i = 0; i < data.length; i++) {
      var code = (data[i][0] || '').toString().trim();
      var redeemURL = (data[i][1] || '').toString().trim();
      var claimed = data[i][2];

      if (code && !claimed) {
        // Mark as claimed with timestamp in column C
        sheet.getRange(i + 1, 3).setValue(new Date().toISOString());

        lock.releaseLock();
        return jsonResponse({
          success: true,
          code: code,
          url: redeemURL,
          remaining: countRemaining(data, i + 1)
        });
      }
    }

    lock.releaseLock();
    return jsonResponse({ success: false, error: 'exhausted' });

  } catch (e) {
    return jsonResponse({ success: false, error: 'lock_timeout' });
  }
}

function getStatus() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var total = 0;
  var claimed = 0;

  for (var i = 0; i < data.length; i++) {
    if (data[i][0]) {
      total++;
      if (data[i][2]) claimed++;
    }
  }

  return jsonResponse({ total: total, claimed: claimed, remaining: total - claimed });
}

function countRemaining(data, startAfterRow) {
  var remaining = 0;
  for (var i = startAfterRow; i < data.length; i++) {
    if (data[i][0] && !data[i][2]) remaining++;
  }
  return remaining;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

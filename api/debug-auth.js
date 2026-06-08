// api/debug-auth.js — TEMPORARY, delete after debugging
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const CORRECT = process.env.DASHBOARD_PASSWORD;
  
  // Show info without revealing the actual password
  return res.status(200).json({
    hasPassword: !!CORRECT,
    passwordLength: CORRECT ? CORRECT.length : 0,
    passwordFirstChar: CORRECT ? CORRECT[0] : null,
    passwordLastChar: CORRECT ? CORRECT[CORRECT.length-1] : null,
    passwordHasSpaces: CORRECT ? CORRECT.includes(' ') : null,
    passwordHasNewline: CORRECT ? CORRECT.includes('\n') : null,
    bodyReceived: req.body,
    bodyType: typeof req.body,
    contentType: req.headers['content-type'],
  });
};

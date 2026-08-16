async function verifyTurnstile(token, remoteIp) {
    if (!token) return false;

    const body = new URLSearchParams();
    body.append('secret', process.env.0x4AAAAAAER9cxcc3f80B4HYF06hqrFOtEQ);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body
    });
    const data = await res.json();
    return data.success === true;
}

module.exports = { verifyTurnstile };
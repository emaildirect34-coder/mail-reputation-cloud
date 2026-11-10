export default {
  async email(message, env) {
    if (message.to.toLowerCase() !== env.DMARC_ADDRESS?.toLowerCase()) {
      message.setReject('Recipient not configured');
      return;
    }
    if (message.rawSize > 5_000_000) {
      message.setReject('DMARC report too large');
      return;
    }
    const target = new URL(env.DMARC_INBOUND_URL);
    if (target.protocol !== 'https:' || !env.DMARC_INBOUND_KEY) throw new Error('DMARC relay is not configured');
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DMARC_INBOUND_KEY}`,
        'Content-Type': 'message/rfc822',
      },
      body: message.raw,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`DMARC endpoint returned HTTP ${response.status}`);
  },
};

// Geocoding via LocationIQ. Free tier: 5,000 requests/day, no credit card
// required. Requires LOCATIONIQ_TOKEN in the environment.
// Falls back to progressively broader slices of the address (dropping the
// leftmost, most specific segment each retry) if the full address doesn't
// resolve - handles hyperlocal landmark names that might not be indexed.
const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_TOKEN;

async function geocodeOnce(query) {
    if (!LOCATIONIQ_TOKEN) throw new Error('LOCATIONIQ_TOKEN is not set in the environment');

    const url = `https://us1.locationiq.com/v1/search` +
        `?key=${LOCATIONIQ_TOKEN}&q=${encodeURIComponent(query)}&countrycodes=in&format=json&limit=1`;

    const res = await fetch(url);
    if (res.status === 404) return null; // LocationIQ returns 404 for "no results"
    if (!res.ok) throw new Error(`LocationIQ returned ${res.status}`);
    const data = await res.json();

    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function geocodeAddress(address) {
    const segments = address.split(',').map(s => s.trim()).filter(Boolean);

    for (let i = 0; i < segments.length; i++) {
        const query = segments.slice(i).join(', ');
        const result = await geocodeOnce(query);
        if (result) return result;
        // LocationIQ's free tier caps at 2 req/sec.
        await new Promise(r => setTimeout(r, 600));
    }

    throw new Error('No results for that address, even after broadening the search');
}

module.exports = { geocodeAddress };
// Free geocoding via OpenStreetMap Nominatim. No API key required, but Nominatim's
// usage policy asks for a descriptive User-Agent and roughly 1 request/sec max -
// fine for per-signup volume here. Swap for Google/Mapbox geocoding later if you
// need higher volume, better accuracy, or India-specific address parsing.
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'ServisoApp/1.0 (support@serviso.org)' }
    });
    if (!res.ok) throw new Error('Geocoding service unavailable');

    const data = await res.json();
    if (!data.length) throw new Error('No results for that address');

    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

module.exports = { geocodeAddress };
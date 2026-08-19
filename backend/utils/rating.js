// Turns a donor's completed-donations count into a 0-5 rating.
// Default scale: 20+ completed donations = a perfect 5.0, linear below that.
// This threshold is a starting guess, not measured against real volume yet -
// easy to retune (or replace with something smarter, e.g. weighted by recency)
// once there's data to tune it against.
const DONATIONS_FOR_PERFECT_RATING = 20;

function computeDonorRating(completedDonationsCount) {
    const capped = Math.min(completedDonationsCount, DONATIONS_FOR_PERFECT_RATING);
    const rating = (capped / DONATIONS_FOR_PERFECT_RATING) * 5;
    return Math.round(rating * 10) / 10;
}

module.exports = { computeDonorRating, DONATIONS_FOR_PERFECT_RATING };
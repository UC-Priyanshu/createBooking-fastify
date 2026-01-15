import reformatPartners from "./reformatPartners.js";

/* ---------------- CONSTANTS (NO REALLOCATION) ---------------- */
const WEIGHTS = Object.freeze({
  distance: 0.0,
  rank: 0.1,
  numberOfBookings: 0.4,
  averageRating: 0.2,
  cancellationRate: -0.3,
});

const MAX_VALUES = Object.freeze({
  distance: 10000,
  rank: 10000,
  numberOfBookings: 3,
  averageRating: 5,
});

/* ---------------- CORE SCORING (INLINE, FAST) ---------------- */
function scoreBeautician(b, max) {
  const distanceScore = 1 - b.distance / max.distance;
  const rankScore = b.rank / max.rank;
  const bookingScore = 1 - b.numberOfBookings / max.numberOfBookings;
  const ratingScore = b.avgrating / max.averageRating;
  const cancellationScore = b.cancellationRate / 100;

  return (
    distanceScore * WEIGHTS.distance +
    rankScore * WEIGHTS.rank +
    bookingScore * WEIGHTS.numberOfBookings +
    ratingScore * WEIGHTS.averageRating +
    cancellationScore * WEIGHTS.cancellationRate
  );
}

/* ---------------- PRIORITIZATION ---------------- */
function prioritizeBeauticians(
  beauticians,
  rescheduleData,
  preferredPartner
) {
  for (let i = 0; i < beauticians.length; i++) {
    beauticians[i].score = scoreBeautician(
      beauticians[i],
      MAX_VALUES
    );
  }

  if (rescheduleData?.status === true && preferredPartner !== "none") {
    const index = beauticians.findIndex(
      (b) => b.id === preferredPartner
    );

    if (index > 0) {
      const [partner] = beauticians.splice(index, 1);
      beauticians.unshift(partner);
    }

    return beauticians;
  }

  // Sort by score (descending)
  return beauticians.sort((a, b) => b.score - a.score);
}

/* ---------------- ENTRY POINT ---------------- */
async function prioritizePartners(
  fastify,
  partnersMap,
  coordinates,
  bookingDate,
  rescheduleData,
  preferredPartner
) {
  // Await only once (no extra async layers)
  const partners = await reformatPartners(
    fastify,
    partnersMap,
    coordinates,
    bookingDate
  );

  return prioritizeBeauticians(
    partners,
    rescheduleData,
    preferredPartner
  );
}

export default prioritizePartners;

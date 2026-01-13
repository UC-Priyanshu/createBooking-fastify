import reformatPartners from "./reformatPartners.js";
// import logger from "../logger.js";
//  Functions to normalize each parameter to a scale of 0 to 1.

const weights = {
    distance: 0.0, // 0% weight
    rank: 0.1, // 10% weight
    numberOfBookings: 0.40, // 40% weight
    averageRating: 0.20, // 20% weight
    cancellationRate: -0.30 // negative weight
};

function normalizeDistance(distance, maxDistance) {
    return 1 - distance / maxDistance;
}

function normalizeRank(rank, maxRank) {
    return rank / maxRank;
}

function normalizeNumberOfBookings(bookings, maxBookings) {
    return 1 - bookings / maxBookings;
}

function normalizeAverageRating(rating) {
    return rating / 5;
}

function normalizeCancellationRate(cancellationRate) {
    return cancellationRate / 100;
}

function calculateScore(beautician, maxValues) {
    const normalizedDistance = normalizeDistance(
        beautician.distance,
        maxValues.distance
    );
    const normalizedRank = normalizeRank(beautician.rank, maxValues.rank);
    const normalizedBookings = normalizeNumberOfBookings(
        beautician.numberOfBookings,
        maxValues.numberOfBookings
    );
    const normalizedRating = normalizeAverageRating(beautician.avgrating);
    const normalizedCancellationRate = normalizeCancellationRate(beautician.cancellationRate);

    // logger.info({line: 32, beautician, normalizedDistance, normalizedRank, normalizedBookings, normalizedRating});
    return (
        (normalizedDistance * weights.distance) +
        (normalizedRank * weights.rank) +
        (normalizedBookings * weights.numberOfBookings) +
        (normalizedRating * weights.averageRating)
        + (normalizedCancellationRate * weights.cancellationRate)
    );
}

function prioritizeBeauticians(beauticians, maxValues, rescheduleData, preferredPartner) {
    beauticians.forEach((beautician) => {
        beautician.score = calculateScore(beautician, maxValues);
        // logger.info({line: 41, beautician});
    });

    if (rescheduleData && rescheduleData.status === true && preferredPartner !== "none") {
        const rescheduledPartner = beauticians.find(beautician => beautician.id === preferredPartner);
        const rescheduledPartnerIndex = beauticians.indexOf(rescheduledPartner);
        beauticians.splice(rescheduledPartnerIndex, 1);
        beauticians.unshift(rescheduledPartner);
        return beauticians;
    }

    // logger.info({line: 51, beauticians});
    return beauticians.sort((a, b) => b.score - a.score);
}

async function prioritizePartners(partnersMap, coordinates, bookingDate, rescheduleData, preferredPartner) {
    // Assign the weights of the the parameters
    const reFormattedPartnersMap = await reformatPartners(
        partnersMap,
        coordinates,
        bookingDate
    );
    // logger.info({line: 62, reFormattedPartnersMap});

    const maxValues = {
        distance: 10000, // maximum possible distance
        rank: 10000, // maximum possible rank
        numberOfBookings: 3, // maximum possible number of bookings
        averageRating: 5, // maximum possible rating
    };

    const prioritizedBeauticians = prioritizeBeauticians(
        reFormattedPartnersMap,
        maxValues, rescheduleData, preferredPartner
    );

    // logger.info({line: 76, prioritizedBeauticians});

    return prioritizedBeauticians;
}

export default prioritizePartners;
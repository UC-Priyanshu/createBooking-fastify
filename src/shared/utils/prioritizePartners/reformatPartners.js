import {
  checkAPIStatus,
  getMAPBOXAPIToken,
  increaseMAPBOXAPIHitCount,
  increaseMAPBOXAPIHitCountForCreateBooking,
} from "../helpers.js";

const MAPBOX_BASE_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

let MAPBOX_TOKEN_CACHE = null;

/* ---------------- MAPBOX DISTANCE (FAST) ---------------- */
async function calculateDistance(
  fastify,
  partnerLat,
  partnerLng,
  { latitude, longitude }
) {
  if (!MAPBOX_TOKEN_CACHE) {
    const status = await checkAPIStatus(fastify);
    MAPBOX_TOKEN_CACHE = getMAPBOXAPIToken(status?.MAPBOX_Authorization);
    if (!MAPBOX_TOKEN_CACHE) {
      throw new Error("Mapbox token missing");
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); 

  try {
    const url = `${MAPBOX_BASE_URL}/${partnerLng},${partnerLat};${longitude},${latitude}?access_token=${MAPBOX_TOKEN_CACHE}&overview=false`;

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Mapbox error");

    const data = await res.json();
    if (!data.routes?.length) return Infinity;

    // fire-and-forget counters
    setImmediate(() => {
      increaseMAPBOXAPIHitCount().catch(() => {});
      increaseMAPBOXAPIHitCountForCreateBooking().catch(() => {});
    });

    return data.routes[0].distance;
  } catch {
    return Infinity; // treat unreachable as far away
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------- BOOKINGS COUNT (FAST) ---------------- */
async function fetchNumberOfBookings(fastify, partnerId, bookingDate) {
  const firestore = fastify.firebase.firestore;

  const start = new Date(bookingDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // If Firestore aggregation is available (MUCH faster)
  if (firestore.collection("BOOKINGS").count) {
    const snap = await firestore
      .collection("BOOKINGS")
      .where("assignedpartnerid", "==", partnerId)
      .where("bookingdateIsoString", ">=", start.toISOString())
      .where("bookingdateIsoString", "<", end.toISOString())
      .where("status", "in", [
        "pending",
        "confirmed",
        "tripstarted",
        "jobstarted",
        "jobfinished",
        "rated",
      ])
      .count()
      .get();

    return snap.data().count;
  }

  // fallback
  const snap = await firestore
    .collection("BOOKINGS")
    .where("assignedpartnerid", "==", partnerId)
    .where("bookingdateIsoString", ">=", start.toISOString())
    .where("bookingdateIsoString", "<", end.toISOString())
    .where("status", "in", [
      "pending",
      "confirmed",
      "tripstarted",
      "jobstarted",
      "jobfinished",
      "rated",
    ])
    .get();

  return snap.size;
}

/* ---------------- MAIN FUNCTION ---------------- */
async function reformatPartners(fastify, partnersMap, coordinates, bookingDate) {
  const firestore = fastify.firebase.firestore;

  // 🔥 Parallel everything
  const tasks = partnersMap.map(async ({ id }) => {
    const partnerRef = firestore.collection("partner").doc(id);

    const [doc, bookings, distance] = await Promise.all([
      partnerRef.get(),
      fetchNumberOfBookings(fastify, id, bookingDate),
      calculateDistance(fastify, null, null, coordinates), // lazy inject below
    ]);

    if (!doc.exists) return null;

    const {
      latitude,
      longitude,
      rank,
      avgrating,
      cancellationRate = 0,
    } = doc.data();

    // now compute distance with actual coords
    const finalDistance = await calculateDistance(
      fastify,
      latitude,
      longitude,
      coordinates
    );

    return {
      id,
      distance: finalDistance,
      rank,
      numberOfBookings: bookings,
      avgrating,
      cancellationRate,
    };
  });

  const results = await Promise.all(tasks);
  return results.filter(Boolean);
}

export default reformatPartners;

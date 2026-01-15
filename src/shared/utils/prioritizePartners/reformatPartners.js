import {
  checkAPIStatus,
  getMAPBOXAPIToken,
  increaseMAPBOXAPIHitCount,
  increaseMAPBOXAPIHitCountForCreateBooking,
} from "../helpers.js";

const MAPBOX_BASE_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

let MAPBOX_TOKEN_CACHE = null;

/* ---------------- FAST DISTANCE (TOKEN PRE-CACHED) ---------------- */
async function calculateDistanceFast(partnerLat, partnerLng, { latitude, longitude }) {
  if (!MAPBOX_TOKEN_CACHE || !partnerLat || !partnerLng) return Infinity;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); 

  try {
    const url = `${MAPBOX_BASE_URL}/${partnerLng},${partnerLat};${longitude},${latitude}?access_token=${MAPBOX_TOKEN_CACHE}&overview=false`;
    
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("Mapbox error");

    const data = await res.json();
    if (!data.routes?.length) return Infinity;

    // Fire-and-forget counters (non-blocking)
    setImmediate(() => {
      increaseMAPBOXAPIHitCount().catch(() => {});
      increaseMAPBOXAPIHitCountForCreateBooking().catch(() => {});
    });

    return data.routes[0].distance;
  } catch {
    return Infinity;
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

/* ---------------- MAIN FUNCTION (OPTIMIZED) ---------------- */
async function reformatPartners(fastify, partnersMap, coordinates, bookingDate) {
  const firestore = fastify.firebase.firestore;

  const reformatStart = process.hrtime.bigint();
  console.log(`      [REFORMAT] Processing ${partnersMap.length} partners...`);

  // 🚀 PRE-WARM: Ensure Mapbox token is cached BEFORE parallel API calls
  if (!MAPBOX_TOKEN_CACHE) {
    const status = await checkAPIStatus(fastify);
    MAPBOX_TOKEN_CACHE = getMAPBOXAPIToken(status?.MAPBOX_Authorization);
  }

  // 🚀 PHASE 1: Batch all Firestore reads in parallel
  const partnerRefs = partnersMap.map(({ id }) => 
    firestore.collection("partner").doc(id)
  );
  
  const [partnerDocs, bookingCounts] = await Promise.all([
    firestore.getAll(...partnerRefs),
    Promise.all(
      partnersMap.map(({ id }) => fetchNumberOfBookings(fastify, id, bookingDate))
    ),
  ]);

  // 🚀 PHASE 2: Extract valid partner data
  const validPartners = [];
  for (let i = 0; i < partnerDocs.length; i++) {
    const doc = partnerDocs[i];
    if (!doc.exists) continue;
    
    const data = doc.data();
    validPartners.push({
      id: partnersMap[i].id,
      latitude: data.latitude,
      longitude: data.longitude,
      rank: data.rank,
      avgrating: data.avgrating,
      cancellationRate: data.cancellationRate || 0,
      bookings: bookingCounts[i],
    });
  }

  // 🚀 PHASE 3: ALL Mapbox distance calls in TRUE parallel (uses pre-cached token)
  const distancePromises = validPartners.map((p) =>
    calculateDistanceFast(p.latitude, p.longitude, coordinates)
  );
  const distances = await Promise.all(distancePromises);

  // 🚀 PHASE 4: Build final results
  const results = validPartners.map((p, i) => ({
    id: p.id,
    distance: distances[i],
    rank: p.rank,
    numberOfBookings: p.bookings,
    avgrating: p.avgrating,
    cancellationRate: p.cancellationRate,
  }));

  const reformatTime = Number(process.hrtime.bigint() - reformatStart) / 1_000_000;
  console.log(`      [REFORMAT] Completed in: ${reformatTime.toFixed(2)}ms`);
  
  return results;
}

export default reformatPartners;

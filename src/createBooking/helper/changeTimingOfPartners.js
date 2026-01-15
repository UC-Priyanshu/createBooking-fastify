export async function changeTimingOfPartners(
  fastify,
  bookingData,
  recheckAvailabilityOfPartner,
  bookingDate,
  bookingId
) {
  const { firestore } = fastify.firebase;

  const partnerId = recheckAvailabilityOfPartner.partner.id;
  const timingId = bookingDate.replace(/-/g, ""); // faster than substrings

  /* ---------- SLOT CALCULATION (FAST) ---------- */
  const slotStart = bookingData.slotnumber;
  const slotCount = Math.ceil(bookingData.bookingsminutes / 30);
  const listOfBookedSlots = Array.from(
    { length: slotCount },
    (_, i) => slotStart + i
  );

  /* ---------- FIRESTORE REFS ---------- */
  const timingRef = firestore
    .collection("partner")
    .doc(partnerId)
    .collection("timings")
    .doc(timingId);

  const partnerRef = firestore.collection("partner").doc(partnerId);

  try {
    /* ---------- PARALLEL READ ---------- */
    const readStart = process.hrtime.bigint();
    const [timingSnap, partnerSnap] = await Promise.all([
      timingRef.get(),
      partnerRef.get(),
    ]);
    const readTime = Number(process.hrtime.bigint() - readStart) / 1_000_000;
    console.log(`      [DB] Fetch timing & partner docs: ${readTime.toFixed(2)}ms`);

    const partnerNonWorkingSlots = partnerSnap.exists
      ? partnerSnap.data().nonWorkingSlots || []
      : [];

    /* =========================================================
       EXISTING TIMING DOCUMENT
       ========================================================= */
    if (timingSnap.exists) {
      const data = timingSnap.data();

      const availableSet = new Set(data.available || []);
      const bookedSet = new Set(data.booked || []);
      const bookings = data.bookings || [];

      for (const slot of listOfBookedSlots) {
        availableSet.delete(slot);
        bookedSet.add(slot);
      }

      bookings.push({ [bookingId]: listOfBookedSlots });

      const updateStart = process.hrtime.bigint();
      await timingRef.update({
        available: [...availableSet].sort((a, b) => a - b),
        booked: [...bookedSet].sort((a, b) => a - b),
        nonWorkingSlots: data.nonWorkingSlots || partnerNonWorkingSlots,
        bookings,
      });
      const updateTime = Number(process.hrtime.bigint() - updateStart) / 1_000_000;
      console.log(`      [DB] Update timing document: ${updateTime.toFixed(2)}ms`);

      return {
        statusCode: 200,
        status: "success",
        message: "Booking updated successfully",
      };
    }

    /* =========================================================
       NEW TIMING DOCUMENT
       ========================================================= */
    const bookedSet = new Set(listOfBookedSlots);
    const availableSlots = [];

    for (let i = 0; i <= 23; i++) {
      if (!bookedSet.has(i)) availableSlots.push(i);
    }

    const createStart = process.hrtime.bigint();
    await timingRef.set({
      available: availableSlots,
      booked: listOfBookedSlots,
      dateTime: getCurrentDateFormatted(),
      nonWorkingSlots: partnerNonWorkingSlots,
      leave: [],
      bookings: [{ [bookingId]: listOfBookedSlots }],
    });
    const createTime = Number(process.hrtime.bigint() - createStart) / 1_000_000;
    console.log(`      [DB] Create new timing document: ${createTime.toFixed(2)}ms`);

    return {
      statusCode: 200,
      status: "success",
      message: "New timing document created and booking updated successfully",
    };
  } catch {
    return {
      statusCode: 400,
      status: "error",
      message: "Error in changeTimingOfPartners",
    };
  }
}

/* =========================================================
   UTILITIES (FAST)
   ========================================================= */

function getCurrentDateFormatted() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(now);

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  })
    .format(now)
    .replace(/:/g, ".");

  return `${date} at ${time} [UTC]+05:30`;
}

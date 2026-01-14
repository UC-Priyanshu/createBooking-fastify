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
    const [timingSnap, partnerSnap] = await Promise.all([
      timingRef.get(),
      partnerRef.get(),
    ]);

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

      await timingRef.update({
        available: [...availableSet].sort((a, b) => a - b),
        booked: [...bookedSet].sort((a, b) => a - b),
        nonWorkingSlots: data.nonWorkingSlots || partnerNonWorkingSlots,
        bookings,
      });

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

    await timingRef.set({
      available: availableSlots,
      booked: listOfBookedSlots,
      dateTime: getCurrentDateFormatted(),
      nonWorkingSlots: partnerNonWorkingSlots,
      leave: [],
      bookings: [{ [bookingId]: listOfBookedSlots }],
    });

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

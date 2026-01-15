async function recheckAvailabilityOfPartner(
  fastify,
  slotNo,
  prioritizedPartners,
  bookingDate,
  bookingData,
  rescheduleData
) {
  const firestore = fastify.firebase.firestore;
  const dateId = bookingDate.replace(/-/g, "");

  const partnerMissedLeadReasonListOfMap = [];

  const timingPromises = prioritizedPartners.map((partner) =>
    firestore
      .collection("partner")
      .doc(partner.id)
      .collection("timings")
      .doc(dateId)
      .get()
      .catch(() => null) 
  );
  
  const timingSnapshots = await Promise.all(timingPromises);

  // Now iterate with pre-fetched data
  for (let i = 0; i < prioritizedPartners.length; i++) {
    const partner = prioritizedPartners[i];
    const snapshot = timingSnapshots[i];
    
    // Skip if fetch failed
    if (snapshot === null) {
      continue;
    }

    // If timing doc does NOT exist → partner available
    if (!snapshot.exists) {
      return {
        partner,
        availablityStatus: true,
        partnerMissedLeadReasonListOfMap,
      };
    }

    const data = snapshot.data();

    // Convert arrays to Sets for O(1) lookup
    const available = new Set(data.available || []);
    const booked = new Set(data.booked || []);
    const leave = new Set(data.leave || []);
    const nonWorkingSlots = new Set(data.nonWorkingSlots || []);

    /* ---------------- RESCHEDULE LEAVE CHECK ---------------- */
    if (
      rescheduleData?.status === true &&
      bookingData.listofbookedslots?.some((slot) => leave.has(slot)) &&
      leave.has(slotNo)
    ) {
      partnerMissedLeadReasonListOfMap.push({
        partner: partner.id,
        reason: "Partner is on leave",
      });
      continue;
    }

    /* ---------------- AVAILABLE SLOT ---------------- */
    if (available.has(slotNo)) {
      return {
        partner,
        availablityStatus: true,
        partnerMissedLeadReasonListOfMap,
      };
    }

    /* ---------------- RESCHEDULE BOOKED SLOT ---------------- */
    if (
      booked.has(slotNo) &&
      rescheduleData?.status === true &&
      bookingData.listofbookedslots?.includes(slotNo)
    ) {
      return {
        partner,
        availablityStatus: true,
        partnerMissedLeadReasonListOfMap,
      };
    }

    /* ---------------- MISSED LEAD REASONS ---------------- */
    if (nonWorkingSlots.has(slotNo)) {
      partnerMissedLeadReasonListOfMap.push({
        partner: partner.id,
        reason: "Partner is not available Due to Non working slots",
      });
    } else if (leave.has(slotNo)) {
      partnerMissedLeadReasonListOfMap.push({
        partner: partner.id,
        reason: "Partner is on leave",
      });
    }
  }

  return {
    statusCode: 400,
    message: "All Partner is on leave.",
    availablityStatus: false,
    partnerMissedLeadReasonListOfMap,
  };
}

export default recheckAvailabilityOfPartner;

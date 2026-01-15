import * as geofire from 'geofire-common';
import { sendNotification } from '../../shared/utils/sendNotification.js';

export async function assignBookingToPartner(
  fastify,
  bookingData,
  preferredPartner,
  recheckPartnersAvailability,
  bookingDate,
  rescheduleData
) {
  const { firestore, FieldValue, admin } = fastify.firebase;
  const GeoPoint = admin.firestore.GeoPoint;

  try {
    const currentPartner = recheckPartnersAvailability.partner;
    const isReschedule = rescheduleData?.status === true;

    const partnerRef = firestore.collection("partner").doc(currentPartner.id);

    // Fetch only what is required
    const countPromise = isReschedule
      ? null
      : firestore.collection("BOOKINGS").doc("COUNTS").get();

    const fetchStart = process.hrtime.bigint();
    const [partnerSnap, countSnap] = await Promise.all([
      partnerRef.get(),
      countPromise,
    ]);
    const fetchTime = Number(process.hrtime.bigint() - fetchStart) / 1_000_000;
    console.log(`      [DB] Fetch partner & count docs: ${fetchTime.toFixed(2)}ms`);

    if (!partnerSnap.exists) {
      return { status: "error", message: "Partner not found" };
    }

    const partnerData = partnerSnap.data();

    /* ---------- PREPARE ASSIGNED PARTNER DATA ---------- */
    const assigned = {
      hubId: partnerData.hubIds,
      id: currentPartner.id,
      name: partnerData.name,
      phone: partnerData.phone,
      profileUrl: partnerData.profileUrl,
      rating: partnerData.avgrating?.toString() || "5",
    };

    const assignedpartnerid = currentPartner.id;
    const finalCredits = Math.round(bookingData.priceToPay / 50);

    /* ---------- SLOT CALCULATION ---------- */
    const slotNumber = isReschedule
      ? rescheduleData.rescheduleSlotNumber
      : bookingData.slotnumber;

    // const listOfBookedSlots = calculateBookedSlots(
    //   bookingData.bookingsminutes,
    //   slotNumber
    // );
    const numberOfSlots = Math.ceil(bookingData.bookingsminutes / 30);
    const listOfBookedSlots = [];
    for (let i = 0; i < numberOfSlots; i++) {
        listOfBookedSlots.push(slotNumber + i);
    }

    /* ---------- BOOKING ID ---------- */
    let bookingid = bookingData.bookingid;
    if (!isReschedule && countSnap) {
      bookingid = (countSnap.data()?.count || 0) + 1;
    }

    /* ---------- FINAL BOOKING DATA (NO MUTATION) ---------- */
    const finalBookingData = {
      ...bookingData,
      bookingid,
      assigned,
      assignedpartnerid,
      bookingdate: new Date(bookingDate),
      bookingdateIsoString: new Date(bookingDate).toISOString(),
      listofbookedslots: listOfBookedSlots,
      createdat: FieldValue.serverTimestamp(),
      point: new GeoPoint(bookingData.latitude, bookingData.longitude),
      geoHash: geofire.geohashForLocation([
        bookingData.latitude,
        bookingData.longitude,
      ]),
      credits: finalCredits,
      status: "pending",
      preferredPartner: preferredPartner ?? "",
      ...(isReschedule && { slotnumber: slotNumber }),
    };

    /* ---------- FIRESTORE BATCH (FAST) ---------- */
    const batch = firestore.batch();
    const bookingRef = firestore
      .collection("BOOKINGS")
      .doc(bookingData.orderId);

    if (isReschedule) {
      batch.update(bookingRef, finalBookingData);
    } else {
      const countRef = firestore.collection("BOOKINGS").doc("COUNTS");
      batch.set(countRef, { count: bookingid }, { merge: true });
      batch.set(bookingRef, finalBookingData);
    }

    const batchStart = process.hrtime.bigint();
    await batch.commit();
    const batchTime = Number(process.hrtime.bigint() - batchStart) / 1_000_000;
    console.log(`      [DB] Batch commit (create booking): ${batchTime.toFixed(2)}ms`);

    /* ---------- NON-BLOCKING NOTIFICATION ---------- */
    setImmediate(() => {
      sendNotification(
        fastify,
        assignedpartnerid,
        bookingData.name,
        bookingData.orderId,
        isReschedule
      ).catch(() => {});
    });

    return {
      statusCode: 200,
      status: "Placed",
      message: isReschedule
        ? "Booking is successfully rescheduled and assigned to a new partner."
        : "Booking is successfully placed and assigned to a partner.",
      bookingId: bookingid,
      partnerId: assignedpartnerid,
    };
  } catch (error) {
    return {
      status: "error",
      message: "Error in assignBookingToPartner: " + error.message,
    };
  }
}

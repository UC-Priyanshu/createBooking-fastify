function convertYYYYMMDDToDate(yyyymmdd) {
  const year = +yyyymmdd.slice(0, 4);
  const month = +yyyymmdd.slice(4, 6) - 1;
  const day = +yyyymmdd.slice(6, 8);
  return new Date(year, month, day);
}

async function initMissedLeads(
  fastify,
  partnerMissedLeadReasonListOfMap,
  bookingData,
  bookingDate
) {
  if (!partnerMissedLeadReasonListOfMap?.length) return;

  const formattedBookingDate = convertYYYYMMDDToDate(
    bookingDate.replace(/-/g, "")
  );

  setImmediate(() => {
    const tasks = partnerMissedLeadReasonListOfMap.map(({ partner, reason }) =>
      handleMissedLead(
        fastify,
        partner,
        reason,
        bookingData,
        formattedBookingDate
      )
    );

    Promise.allSettled(tasks).catch(() => {});
  });
}

async function handleMissedLead(
  fastify,
  partnerId,
  reason,
  bookingData,
  bookingDate
) {
  const { firestore, FieldValue, admin } = fastify.firebase;

  const {
    bookingid,
    orderId,
    address,
    name,
    priceToPay,
    listofbookedslots,
  } = bookingData;

  await Promise.allSettled([
    initMissedLeadForPartner(
      firestore,
      FieldValue,
      partnerId,
      bookingDate,
      bookingid,
      orderId,
      reason,
      address,
      name,
      priceToPay,
      listofbookedslots
    ),
    sendNotificationForMissedLeads(fastify, partnerId, reason),
  ]);
}

async function initMissedLeadForPartner(
  firestore,
  FieldValue,
  partnerId,
  bookingDate,
  bookingId,
  orderId,
  reason,
  clientAddress,
  clientName,
  amount,
  bookedSlots
) {
  const missedLeadRef = firestore
    .collection("partner")
    .doc(partnerId)
    .collection("performance")
    .doc("missedLeads")
    .collection("all")
    .doc(orderId);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(missedLeadRef);

    if (snap.exists) {
      tx.update(missedLeadRef, {
        bookingDate,
        missedAt: FieldValue.serverTimestamp(),
        reason,
        address: clientAddress,
        name: clientName,
        amount,
        bookedSlots,
      });
    } else {
      tx.set(missedLeadRef, {
        bookingDate,
        bookingId,
        orderId,
        reason,
        address: clientAddress,
        name: clientName,
        amount,
        bookedSlots,
        createdAt: FieldValue.serverTimestamp(),
        missedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}


async function sendNotificationForMissedLeads(fastify, partnerId, reason) {
  const { firestore, admin } = fastify.firebase;

  const partnerDoc = await firestore
    .collection("partner")
    .doc(partnerId)
    .get();

  if (!partnerDoc.exists) return;

  const fcmToken = partnerDoc.data()?.fcmtoken;
  if (!fcmToken) return;

  let finalReason = "";
  if (reason.includes("Non working slots")) finalReason = "Non working slots";
  else if (reason.includes("leave")) finalReason = "on Leave";

  const message = {
    token: fcmToken,
    notification: {
      title: "Missed Lead",
      body: `You have missed a lead due to ${finalReason}`,
    },
    data: { type: "missedLeadNotification" },
    android: {
      priority: "high",
      notification: {
        sound: "sound",
        channelId: "missed_lead",
      },
    },
  };

  admin.messaging().send(message).catch(() => {});
}

export { initMissedLeads };

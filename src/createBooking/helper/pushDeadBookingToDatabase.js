const COLLECTION_NAME = "BOOKINGS";

export async function pushDeadBookingToDatabase(fastify, bookingData) {
  const { firestore, FieldValue } = fastify.firebase;

  const bookingsCol = firestore.collection(COLLECTION_NAME);
  const countRef = bookingsCol.doc("COUNTS");
  const bookingRef = bookingsCol.doc(bookingData.orderId);

  try {
    await firestore.runTransaction(async (tx) => {
      const countDoc = await tx.get(countRef);
      const currentCount = countDoc.exists
        ? countDoc.data().count || 0
        : 0;

      const newBookingId = currentCount + 1;

      const finalBookingData = {
        ...bookingData,
        bookingid: newBookingId,
        createdat: FieldValue.serverTimestamp(),
        credits: Math.round((bookingData.priceToPay - 99) / 50),
        status: "dead(NOR)",
      };

      tx.set(countRef, { count: newBookingId }, { merge: true });
      tx.set(bookingRef, finalBookingData);
    });

    return {
      statusCode: 200,
      status: "Dead",
      message:
        "Due to high demand, your booking can not be placed at the moment. Please try again later.",
    };
  } catch (error) {
    return {
      statusCode: 500,
      status: "Error",
      message: "Error in pushDeadBookingToDatabase",
    };
  }
}

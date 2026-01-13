// import logger from '../../shared/utils/logger.js';

// Define constant for performance (avoid string allocation on every request)
const COLLECTION_NAME = "BOOKINGS"; 

export async function pushDeadBookingToDatabase(fastify, bookingData) {
    try {
        // Access Firebase through fastify decorator
        const { firestore, FieldValue } = fastify.firebase;
        
        // ---------------------------------------------------------
        // OPTIMIZATION: Transaction (Guarantees Unique IDs)
        // ---------------------------------------------------------
        await firestore.runTransaction(async (transaction) => {
            const countRef = firestore.collection(COLLECTION_NAME).doc("COUNTS");
            const bookingRef = firestore.collection(COLLECTION_NAME).doc(bookingData.orderId);

            // 1. Read Count (Locked)
            const countDoc = await transaction.get(countRef);
            const currentCount = countDoc.exists ? (countDoc.data().count || 0) : 0;
            const newBookingId = currentCount + 1;

            // 2. Prepare Data
            // Calculation logic kept same
            const finalBookingData = {
                ...bookingData,
                bookingid: newBookingId,
                createdat: FieldValue.serverTimestamp(),
                credits: Math.round((bookingData.priceToPay - 99) / 50),
                status: "dead(NOR)",
            };

            // 3. Atomic Writes
            transaction.set(countRef, { count: newBookingId }, { merge: true });
            transaction.set(bookingRef, finalBookingData);
        });

        // ---------------------------------------------------------
        // Response (Success)
        // ---------------------------------------------------------
        return {
            statusCode: 200,
            status: "Dead",
            message: "Due to high demand, your booking can not be placed at the moment. Please try again later.",
        };

    } catch (error) {
        // ---------------------------------------------------------
        // Error Handling (Consistent Return Type)
        // ---------------------------------------------------------
        // Return Object instead of string for consistent API parsing
        return {
            statusCode: 500,
            status: "Error",
            message: `Error in pushDeadBookingToDatabase: ${error.message}`
        };
    }
}
import { firestore } from "../../../plugin/firebase.js";
// import logger from "../../utils/logger.js";

async function fetchBookingDetailsfromDB(bookingId) {
    try {
        const bookingDocRef = firestore.collection("BOOKINGS").doc(bookingId);

        const bookingData = await bookingDocRef.get();
        if (bookingData.exists) {
            return {
                message: "Booking data fetched successfully",
                data: bookingData.data(),
            };
        }
        return {
            statusCode: 404,
            message: "No such Booking document found",
        };
    } catch (error) {
        // logger.info({line: 19, error});
        return new Error("Error in fetchBookingDetailsfromDB: ", error);
    }
}

export default fetchBookingDetailsfromDB;

import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
// const firestore = admin.firestore();
import moment from "moment-timezone";
// import logger from "../logger.js";
import { calculateBookedSlots } from "../calculateBookedSlots.js";

async function changeTimingOfPartners(
    bookingData,
    recheckAvailabilityOfPartner,
    bookingDate
) {
    // console.dir(recheckAvailabilityOfPartner, { depth: null });
    try {
        const timingid =
            bookingDate.substring(0, 4) +
            bookingDate.substring(5, 7) +
            bookingDate.substring(8, 10);
        const listOfBookedSlots = calculateBookedSlots(
            bookingData.bookingsminutes,
            bookingData.slotnumber
        );
        const db = admin.firestore();

        const batch = db.batch();

        const timingref = db
            .collection("partner") // later change it to "partner";
            .doc(recheckAvailabilityOfPartner.partner.id) // Later change it to "recheckAvailabilityOfPartner.partner.id";
            .collection("timings")
            .doc(timingid);

        const timingSnapShot = await timingref.get();

        if (timingSnapShot.exists) {
            const data = timingSnapShot.data();
            const available = data.available || [];
            const booked = data.booked || [];

            // Transfer elements from 'available' to 'booked'
            listOfBookedSlots.forEach((element) => {
                if (available.includes(element)) {
                    available.splice(available.indexOf(element), 1);
                    booked.push(element);
                }
            });

            // Update the document
            await timingref.update({
                available: FieldValue.arrayRemove(...listOfBookedSlots),
                booked: FieldValue.arrayUnion(...listOfBookedSlots),
            });
            // logger.info("Booking updated successfully");
        } else {
            const timingRefDoc = {
                available: getAvailableSlots(listOfBookedSlots),
                booked: listOfBookedSlots,
                dateTime: getCurrentDateFormatted(),
                leave: [],
            };

            batch.set(timingref, timingRefDoc);
            await batch.commit();
            return "Timing Ref Created";
        }
    } catch (error) {
        // logger.info({line: 66, error});
    }
}

function getAvailableSlots(bookedSlots) {
    const availableSlots = [];

    for (let i = 0; i <= 23; i++) {
        if (!bookedSlots.includes(i)) {
            availableSlots.push(i);
        }
    }

    return availableSlots;
}

function getCurrentDateFormatted() {
    const format = "D MMMM YYYY [at] HH.mm.ss [UTC]Z";
    const currentDate = moment().tz("Asia/Kolkata").format(format);
    return currentDate;
}

export {changeTimingOfPartners};

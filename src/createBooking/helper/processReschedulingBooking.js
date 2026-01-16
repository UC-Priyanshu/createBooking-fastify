import { initMissedLeadsFunction } from '../../shared/utils/missed_lead/missed_leads_helper_for_reschedule_booking.js';
import { handleLogs } from '../../shared/utils/booking_logs_helper.js';

export async function processReschedulingBooking(fastify, recheckPartnersAvailability, bookingData, bookingDate, rescheduleData) {
    const { firestore, FieldValue, admin } = fastify.firebase;
    const Timestamp = admin.firestore.Timestamp;

    // Validate required fields
    if (!bookingData.bookingdateIsoString) {
        fastify.log.error({ bookingData }, "Missing bookingdateIsoString in bookingData");
        return {
            statusCode: 400,
            status: "Error",
            message: "Missing bookingdateIsoString in booking data"
        };
    }

    if (!bookingData.assignedpartnerid) {
        fastify.log.error({ bookingData }, "Missing assignedpartnerid in bookingData");
        return {
            statusCode: 400,
            status: "Error",
            message: "Missing assignedpartnerid in booking data"
        };
    }

    const oldBookingDate = bookingData.bookingdateIsoString.substring(0, 10).replace(/-/g, "");
    const timingId = bookingDate.substring(0, 4) + bookingDate.substring(5, 7) + bookingDate.substring(8, 10);

    fastify.log.info({ 
        oldBookingDate, 
        timingId, 
        oldPartnerId: bookingData.assignedpartnerid,
        newPartnerId: recheckPartnersAvailability.partner.id
    }, "Starting reschedule process");

    const oldPartnerId = bookingData.assignedpartnerid;
    const newPartnerId = recheckPartnersAvailability.partner.id;

    const [oldPartnerLeaveDoc, newPartnerLeaveDoc] = await Promise.all([
        getPartnerLeaveDocForDate(firestore, oldPartnerId, oldBookingDate),
        getPartnerLeaveDocForDate(firestore, newPartnerId, timingId)
    ]);

    try {
        const transactionResult = await firestore.runTransaction(async (transaction) => {
            // ============================================
            // PHASE 1: ALL READS (Do all reads first)
            // ============================================
            
            const oldPartnerRef = firestore.collection("partner").doc(bookingData.assignedpartnerid);
            const newPartnerRef = firestore.collection("partner").doc(newPartnerId);
            
            // Read 1: Old partner credit info if needed
            let oldPartnerCreditDoc = null;
            if (bookingData.status !== "pending" && bookingData.status !== "cancelled") {
                const oldPartnerCreditInfoRef = oldPartnerRef.collection("creditinfo").doc("info");
                oldPartnerCreditDoc = await transaction.get(oldPartnerCreditInfoRef);
            }
            
            // Read 2 & 3: Partner data in parallel
            const [newPartnerDoc, oldPartnerDoc] = await Promise.all([
                transaction.get(newPartnerRef),
                transaction.get(oldPartnerRef)
            ]);
            
            // Read 4: Timing documents
            const oldTimingRef = oldPartnerRef.collection("timings").doc(oldBookingDate);
            const newTimingRef = newPartnerRef.collection("timings").doc(timingId);
            
            let oldTimingSnap, newTimingSnap;
            if (oldPartnerRef.id === newPartnerRef.id && oldBookingDate === timingId) {
                // Same partner, same date - read once
                oldTimingSnap = await transaction.get(oldTimingRef);
                newTimingSnap = oldTimingSnap;
            } else {
                // Different partner or date - read in parallel
                [oldTimingSnap, newTimingSnap] = await Promise.all([
                    transaction.get(oldTimingRef),
                    transaction.get(newTimingRef)
                ]);
            }
            
            // ============================================
            // PHASE 2: PREPARE DATA (No DB operations)
            // ============================================
            
            const newPartnerData = newPartnerDoc.data();
            const oldPartnerData = oldPartnerDoc.data();
            const previousListOfBookedSlots = bookingData.listofbookedslots;
            
            // Calculate booked slots
            const numberOfSlots = Math.ceil(bookingData.bookingsminutes / 30);
            const listOfBookedSlots = [];
            for (let i = 0; i < numberOfSlots; i++) {
                listOfBookedSlots.push(rescheduleData.rescheduleSlotNumber + i);
            }
            
            // Prepare previous assigned data (matching Express logic)
            let previousAssigned = {};
            if (bookingData.assigned) {
                previousAssigned = {
                    id: bookingData.assignedpartnerid,
                    name: bookingData.assigned.name,
                    rescheduleTime: Timestamp.now(), // Use Timestamp.now() instead of FieldValue.serverTimestamp() for arrays
                    rescheduleBy: rescheduleData.role || "admin",
                    reason: rescheduleData.reason || ""
                };
                
                if (rescheduleData.role === "agent") {
                    previousAssigned.agentId = rescheduleData.agentId || "";
                    previousAssigned.agentName = rescheduleData.agentName || "";
                }
            }
            
            // Update booking data with new partner info (matching Express logic exactly)
            bookingData.assigned = {
                hubId: newPartnerData.hubIds,
                id: newPartnerId,
                name: newPartnerData.name,
                phone: newPartnerData.phone,
                profileUrl: newPartnerData.profileUrl,
                rating: newPartnerData.avgrating?.toString() || "5",
            };
            bookingData.assignedpartnerid = newPartnerId;
            bookingData.bookingdate = new Date(bookingDate);
            bookingData.listofbookedslots = listOfBookedSlots;
            bookingData.rescheduledAt = FieldValue.serverTimestamp();
            bookingData.bookingdateIsoString = new Date(bookingDate).toISOString();
            bookingData.status = "pending";
            bookingData.slotnumber = rescheduleData.rescheduleSlotNumber;
            
            // Reset incentiveCredits if it exists
            if (bookingData.incentiveCredits !== undefined || bookingData.incentiveCredits !== null) {
                bookingData.incentiveCredits = null;
            }
            
            // Handle reschedule array (matching Express duplicate check logic)
            if (bookingData.assigned) {
                if (!bookingData.reschedule) {
                    bookingData.reschedule = [previousAssigned];
                } else if (bookingData.reschedule && !bookingData.reschedule.some((existingPartner) => existingPartner.id === previousAssigned.id)) {
                    bookingData.reschedule.push(previousAssigned);
                } else {
                    bookingData.reschedule.push(previousAssigned);
                }
            }
            
            // ============================================
            // PHASE 3: ALL WRITES (After all reads)
            // ============================================
            
            // Write 1: Save to RescheduledBookings
            const rescheduledBookingRef = firestore.collection("RescheduledBookings").doc(bookingData.orderId);
            transaction.set(rescheduledBookingRef, bookingData);
            
            // Write 2: Update old partner credits if needed
            if (oldPartnerCreditDoc) {
                const oldPartnerCreditInfoRef = oldPartnerRef.collection("creditinfo").doc("info");
                const oldPartnerCredits = oldPartnerCreditDoc.exists ? oldPartnerCreditDoc.data().availablecredits : 0;
                const newOldPartnerCredits = oldPartnerCredits + bookingData.credits;
                
                transaction.update(oldPartnerCreditInfoRef, { availablecredits: newOldPartnerCredits });
                
                const oldPartnerTransactionRef = oldPartnerRef.collection("credittransaction").doc();
                transaction.set(oldPartnerTransactionRef, {
                    amount: bookingData.credits * 10,
                    count: bookingData.credits,
                    datetime: FieldValue.serverTimestamp(),
                    message: "reimburse",
                    orderId: bookingData.bookingid,
                    type: "recharge",
                    amountBefore: oldPartnerCredits * 10,
                    creditsBefore: oldPartnerCredits,
                    amountAfter: newOldPartnerCredits * 10,
                    creditsAfter: newOldPartnerCredits,
                });
            }
            
            // Write 3: Update booking in main BOOKINGS collection (matching Express fields exactly)
            const bookingRef = firestore.collection("BOOKINGS").doc(bookingData.orderId);
            transaction.update(bookingRef, {
                assigned: bookingData.assigned,
                assignedpartnerid: bookingData.assignedpartnerid,
                bookingdate: bookingData.bookingdate,
                bookingdateIsoString: bookingData.bookingdateIsoString,
                listofbookedslots: bookingData.listofbookedslots,
                rescheduledAt: bookingData.rescheduledAt,
                status: bookingData.status,
                slotnumber: bookingData.slotnumber,
                incentiveCredits: bookingData.incentiveCredits,
                reschedule: bookingData.reschedule
            });
            
            // Write 4: Update old partner timing (REVERT slots)
            if (oldTimingSnap.exists) {
                processSlotUpdateSync(
                    transaction,
                    oldTimingRef,
                    oldTimingSnap.data(),
                    oldPartnerRef.id,
                    oldBookingDate,
                    oldPartnerData.nonWorkingSlots || [],
                    previousListOfBookedSlots,
                    bookingData.bookingid,
                    'REVERT',
                    oldPartnerLeaveDoc
                );
            }
            
            // Write 5: Update new partner timing (BOOK slots)
            if (newTimingSnap.exists) {
                processSlotUpdateSync(
                    transaction,
                    newTimingRef,
                    newTimingSnap.data(),
                    newPartnerRef.id,
                    timingId,
                    newPartnerData.nonWorkingSlots || [],
                    listOfBookedSlots,
                    bookingData.bookingid,
                    'BOOK',
                    newPartnerLeaveDoc
                );
            } else {
                // Create new timing document
                const timingRefDoc = {
                    available: getAvailableSlots(listOfBookedSlots),
                    booked: listOfBookedSlots,
                    dateTime: getCurrentDateFormatted(),
                    leave: [],
                    nonWorkingSlots: newPartnerData.nonWorkingSlots || [],
                    bookings: [{ [bookingData.bookingid]: listOfBookedSlots }]
                };
                transaction.set(newTimingRef, timingRefDoc);
            }

            return {
                isMissedLead: rescheduleData.isMissedLead === true,
                oldPartnerId: oldPartnerRef.id,
                newPartnerId: newPartnerRef.id,
                newPartnerRef // Return ref for response
            };
        });

        fastify.log.info({ 
            transactionResult,
            bookingId: bookingData.orderId 
        }, "Transaction completed successfully");

        // Fire-and-forget async operations (non-blocking)
        if (transactionResult.isMissedLead) {
            initMissedLeadsFunction(
                fastify,
                transactionResult.oldPartnerId,
                transactionResult.newPartnerId,
                oldBookingDate,
                bookingDate,
                firestore.collection('partner').doc(transactionResult.oldPartnerId),
                firestore.collection('partner').doc(transactionResult.newPartnerId),
                bookingData.bookingid,
                bookingData.orderId,
                bookingData.address,
                bookingData.name,
                bookingData.priceToPay,
                bookingData.listofbookedslots
            ).catch(err => { });
            // ).catch(err => logger.error({err}, 'Missed Lead Error'));
        }

        handleLogs(
            fastify,
            transactionResult.oldPartnerId,
            oldBookingDate,
            bookingData.orderId,
            bookingData.bookingid,
            bookingData.priceToPay,
            "rescheduled"
        ).catch(err => { });
        // ).catch(err => logger.error({err}, 'Handle Logs Error'));

        return {
            statusCode: 200,
            newPartnerRef: transactionResult.newPartnerRef,
            status: "Rescheduled",
            message: "Booking is successfully rescheduled.",
        };

    } catch (error) {
        fastify.log.error({ 
            error: error.message, 
            stack: error.stack,
            bookingId: bookingData.orderId 
        }, "Error in processReschedulingBooking");
        
        return {
            statusCode: 500,
            status: "Error",
            message: error.message || "Error in processReschedulingBooking",
            error: error.stack
        };
    }
}


async function makeCreditsRefundForOldPartner(transaction, oldPartnerRef, bookingData) {
    const oldPartnerCreditInfoRef = oldPartnerRef.collection("creditinfo").doc("info");
    const oldPartnerDoc = await transaction.get(oldPartnerCreditInfoRef);

    const oldPartnerCredits = oldPartnerDoc.exists ? oldPartnerDoc.data().availablecredits : 0;
    const newOldPartnerCredits = oldPartnerCredits + bookingData.credits;

    transaction.update(oldPartnerCreditInfoRef, { availablecredits: newOldPartnerCredits });

    const oldPartnerTransactionRef = oldPartnerRef.collection("credittransaction").doc();
    transaction.set(oldPartnerTransactionRef, {
        amount: bookingData.credits * 10,
        count: bookingData.credits,
        datetime: FieldValue.serverTimestamp(),
        message: "reimburse",
        orderId: bookingData.bookingid,
        type: "recharge",
        amountBefore: oldPartnerCredits * 10,
        creditsBefore: oldPartnerCredits,
        amountAfter: newOldPartnerCredits * 10,
        creditsAfter: newOldPartnerCredits,
    });
}

async function assignBookingToNewPartner(firestore, transaction, recheckPartnersAvailability, bookingData, bookingDate, rescheduleData) {
    const newPartner = recheckPartnersAvailability.partner;
    const newPartnerRef = firestore.collection("partner").doc(newPartner.id);
    const newPartnerDoc = await transaction.get(newPartnerRef);
    const newPartnerData = newPartnerDoc.data();

    let previousAssigned = {};
    if (bookingData.assigned) {
        previousAssigned = {
            id: bookingData.assignedpartnerid,
            name: bookingData.assigned.name,
            rescheduleTime: Timestamp.now(),
            rescheduleBy: rescheduleData.role || "admin",
            reason: rescheduleData.reason || "",
            ...(rescheduleData.role === "agent" && {
                agentId: rescheduleData.agentId || "",
                agentName: rescheduleData.agentName || ""
            })
        };
    }

    // const listOfBookedSlots = calculateBookedSlots(bookingData.bookingsminutes, rescheduleData.rescheduleSlotNumber);
    const numberOfSlots = Math.ceil(bookingData.bookingsminutes / 30);
    const listOfBookedSlots = [];
    for (let i = 0; i < numberOfSlots; i++) {
        listOfBookedSlots.push(rescheduleData.rescheduleSlotNumber + i);
    }


    Object.assign(bookingData, {
        assigned: {
            hubId: newPartnerData.hubIds,
            id: newPartner.id,
            name: newPartnerData.name,
            phone: newPartnerData.phone,
            profileUrl: newPartnerData.profileUrl,
            rating: newPartnerData.avgrating?.toString() || "5",
        },
        assignedpartnerid: newPartner.id,
        bookingdate: new Date(bookingDate),
        listofbookedslots: listOfBookedSlots,
        rescheduledAt: FieldValue.serverTimestamp(),
        bookingdateIsoString: new Date(bookingDate).toISOString(),
        status: "pending",
        slotnumber: rescheduleData.rescheduleSlotNumber,
        incentiveCredits: null
    });

    if (!bookingData.reschedule) {
        bookingData.reschedule = [previousAssigned];
    } else {
        bookingData.reschedule.push(previousAssigned);
    }

    const bookingRef = firestore.collection("BOOKINGS").doc(bookingData.orderId);
    transaction.update(bookingRef, bookingData);

    return { newPartnerRef, listOfBookedSlots };
}


async function changeTimingOfPartners(firestore, transaction, bookingDate, oldPartnerRef, newPartnerRef, previousSlots, newSlots, oldBookingDate, bookingId, oldPartnerLeaveDoc, newPartnerLeaveDoc, timingId) {

    const [oldPartnerDoc, newPartnerDoc] = await Promise.all([
        transaction.get(oldPartnerRef),
        transaction.get(newPartnerRef)
    ]);

    const oldTimingRef = oldPartnerRef.collection("timings").doc(oldBookingDate); 
    const newTimingRef = newPartnerRef.collection("timings").doc(timingId);       // Use timingId (new date) for new partner

   
    let oldTimingSnap, newTimingSnap;

    if (oldPartnerRef.id === newPartnerRef.id && oldBookingDate === timingId) {
        oldTimingSnap = await transaction.get(oldTimingRef);
        newTimingSnap = oldTimingSnap; // Same doc
    } else {
        [oldTimingSnap, newTimingSnap] = await Promise.all([
            transaction.get(oldTimingRef),
            transaction.get(newTimingRef)
        ]);
    }


    if (oldTimingSnap.exists) {
        await processSlotUpdate(
            transaction,
            oldTimingRef,
            oldTimingSnap,
            oldPartnerRef.id,
            oldBookingDate, 
            oldPartnerDoc.data().nonWorkingSlots || [],
            previousSlots,
            bookingId,
            'REVERT',
            oldPartnerLeaveDoc
        );
    }


    if (newTimingSnap.exists) {

        await processSlotUpdate(
            transaction,
            newTimingRef,
            newTimingSnap, 
            newPartnerRef.id,
            timingId,
            newPartnerDoc.data().nonWorkingSlots || [],
            newSlots,
            bookingId,
            'BOOK', 
            newPartnerLeaveDoc
        );
    } else {
        const timingRefDoc = {
            available: getAvailableSlots(newSlots),
            booked: newSlots,
            dateTime: getCurrentDateFormatted(),
            leave: [],
            nonWorkingSlots: newPartnerDoc.data().nonWorkingSlots || [],
            bookings: [{ [bookingId]: newSlots }]
        };
        transaction.set(newTimingRef, timingRefDoc);
    }
}

function processSlotUpdateSync(transaction, docRef, data, partnerId, timingId, partnerNonWorkingSlots, slotsToProcess, bookingId, action, leaveDoc) {
    let available = data.available || [];
    let booked = data.booked || [];
    let leave = data.leave || [];
    const nonWorkingSlots = data.nonWorkingSlots || partnerNonWorkingSlots;
    let bookings = data.bookings || [];

    // 1. Handle "Revert" (Old Partner/Date)
    if (action === 'REVERT') {
        // Check Leave Status using pre-fetched doc
        let isLeaveApproved = false;
        let leaveSlotsForDay = [];

        if (leave.length > 0 && leaveDoc && leaveDoc.exists && leaveDoc.data().status === 'approved') {
            isLeaveApproved = true;
            leaveSlotsForDay = leaveDoc.data().slotsPerDay[timingId] || [];
        }

        // Logic: Remove from 'booked', add to 'leave' or 'available'
        slotsToProcess.forEach(slot => {
            const idx = booked.indexOf(slot);
            if (idx !== -1) booked.splice(idx, 1);

            if (isLeaveApproved && leaveSlotsForDay.includes(slot)) {
                leave.push(slot);
            } else {
                available.push(slot);
            }
        });

        // Remove from bookings log
        bookings = bookings.filter(log => !log.hasOwnProperty(bookingId));
    }

    // 2. Handle "Book" (New Partner/Date)
    if (action === 'BOOK') {
        slotsToProcess.forEach(slot => {
            const idx = available.indexOf(slot);
            if (idx !== -1) available.splice(idx, 1);

            if (!booked.includes(slot)) booked.push(slot);
        });

        const existingIndex = bookings.findIndex(log => log.hasOwnProperty(bookingId));
        if (existingIndex !== -1) {
            bookings[existingIndex][bookingId] = slotsToProcess;
        } else {
            bookings.push({ [bookingId]: slotsToProcess });
        }
    }

    // 3. Sort Everything (Clean Data)
    booked.sort((a, b) => a - b);
    available.sort((a, b) => a - b);
    leave.sort((a, b) => a - b);
    transaction.update(docRef, {
        booked, available, leave, nonWorkingSlots, bookings
    });
}

async function processSlotUpdate(transaction, docRef, docSnap, partnerId, timingId, partnerNonWorkingSlots, slotsToProcess, bookingId, action, leaveDoc) {
    const data = docSnap.data();
    let available = data.available || [];
    let booked = data.booked || [];
    let leave = data.leave || [];
    const nonWorkingSlots = data.nonWorkingSlots || partnerNonWorkingSlots;
    let bookings = data.bookings || [];

    // 1. Handle "Revert" (Old Partner/Date)
    if (action === 'REVERT') {
        // Check Leave Status using pre-fetched doc
        let isLeaveApproved = false;
        let leaveSlotsForDay = [];

        if (leave.length > 0 && leaveDoc && leaveDoc.exists && leaveDoc.data().status === 'approved') {
            isLeaveApproved = true;
            leaveSlotsForDay = leaveDoc.data().slotsPerDay[timingId] || [];
        }

        // Logic: Remove from 'booked', add to 'leave' or 'available'
        slotsToProcess.forEach(slot => {
            const idx = booked.indexOf(slot);
            if (idx !== -1) booked.splice(idx, 1);

            if (isLeaveApproved && leaveSlotsForDay.includes(slot)) {
                leave.push(slot);
            } else {
                available.push(slot);
            }
        });

        // Remove from bookings log
        bookings = bookings.filter(log => !log.hasOwnProperty(bookingId));
    }

    // 2. Handle "Book" (New Partner/Date)
    if (action === 'BOOK') {
        slotsToProcess.forEach(slot => {
            const idx = available.indexOf(slot);
            if (idx !== -1) available.splice(idx, 1);

            if (!booked.includes(slot)) booked.push(slot);
        });

        const existingIndex = bookings.findIndex(log => log.hasOwnProperty(bookingId));
        if (existingIndex !== -1) {
            bookings[existingIndex][bookingId] = slotsToProcess;
        } else {
            bookings.push({ [bookingId]: slotsToProcess });
        }
    }

    // 3. Sort Everything (Clean Data)
    booked.sort((a, b) => a - b);
    available.sort((a, b) => a - b);
    leave.sort((a, b) => a - b);
    transaction.update(docRef, {
        booked, available, leave, nonWorkingSlots, bookings
    });
}

function getAvailableSlots(bookedSlots) {
    const availableSlots = [];
    for (let i = 0; i <= 23; i++) {
        if (!bookedSlots.includes(i)) availableSlots.push(i);
    }
    return availableSlots;
}

function getCurrentDateFormatted() {
    const now = new Date();
   
    const datePart = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
    const timePart = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(now).replace(/:/g, '.');
    return `${datePart} at ${timePart} [UTC]+05:30`;
}

async function getPartnerLeaveDocForDate(firestore, partnerId, date) {
    const snapshot = await firestore.collection("partnerLeaves")
        .where("partnerId", "==", partnerId)
        .where("dayList", "array-contains", date)
        .limit(1)
        .get();

    return !snapshot.empty ? snapshot.docs[0] : null;
}
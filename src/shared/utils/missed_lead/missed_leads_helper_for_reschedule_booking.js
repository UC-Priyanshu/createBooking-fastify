function convertYYYYMMDDToDate(yyyymmdd) {
    if (typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) {
        throw new Error("Invalid input: Expected a string in 'yyyymmdd' format");
    }

    const year = parseInt(yyyymmdd.substring(0, 4), 10);
    const month = parseInt(yyyymmdd.substring(4, 6), 10) - 1; // Month is 0-based in JS
    const day = parseInt(yyyymmdd.substring(6, 8), 10);

    return new Date(year, month, day);
}

// const formatMonth = (date) => {
//     const jsDate = date instanceof Date ? date : date.toDate?.() || new Date(date);
//     return jsDate.toISOString().substr(0, 7).replace(/-/g, '');
// };


async function initMissedLeadsFunction(fastify, oldPartnerId, newPartnerId, oldBookingDate, newBookingDate, oldPartnerDoc, newPartnerDoc, bookingId, orderId, clientAddress, clientName, priceToPay, bookedSlots) {
    const logPrefix = `[MissedLeads][Order:${orderId}][Booking:${bookingId}]`;

    try {
        const _old = convertYYYYMMDDToDate(oldBookingDate);
        const _new = convertYYYYMMDDToDate(newBookingDate.replace(/-/g, ''));

        const isPartnerSame = oldPartnerId === newPartnerId;
        const isBookingDateSame = _old.toISOString().slice(0, 10) === _new.toISOString().slice(0, 10);

        const bookingDateForEntry = isBookingDateSame ? _new : _old;

        const oldRef = firestore
            .collection('partner')
            .doc(oldPartnerId)
            .collection('performance')
            .doc('missedLeads')
            .collection('all')
            .doc(orderId);

        const newRef = firestore
            .collection('partner')
            .doc(newPartnerId)
            .collection('performance')
            .doc('missedLeads')
            .collection('all')
            .doc(orderId);

        await firestore.runTransaction(async (tx) => {
            // ---- READS (must be before writes) ----
            let oldSnap, newSnap;

            if (isPartnerSame) {
                oldSnap = await tx.get(oldRef);
            } else {
                [oldSnap, newSnap] = await Promise.all([tx.get(oldRef), tx.get(newRef)]);
            }

            // ---- WRITES ----

            // 1) If different partners, delete from new partner (he shouldn't carry the miss)
            if (!isPartnerSame && newSnap?.exists) {
                // logger.info(`${logPrefix} Deleting missed lead from new partner`);
                tx.delete(newRef);
            }

            // 2) Upsert on old partner (the one who missed)
            const payloadUpdate = {
                bookingDate: bookingDateForEntry,
                missedAt: FieldValue.serverTimestamp(),
                reason: 'Booking rescheduled',
                address: clientAddress,
                name: clientName,
                amount: priceToPay,
                bookedSlots: bookedSlots,
            };

            if (oldSnap?.exists) {
                // logger.info(`${logPrefix} Updating existing missed lead for old partner`);
                tx.update(oldRef, payloadUpdate);
            } else {
                // logger.info(`${logPrefix} Creating new missed lead for old partner`);
                tx.set(oldRef, {
                    bookingDate: bookingDateForEntry,
                    bookingId,
                    orderId,
                    createdAt: FieldValue.serverTimestamp(),
                    missedAt: FieldValue.serverTimestamp(),
                    reason: 'Booking rescheduled',
                    address: clientAddress,
                    name: clientName,
                    amount: priceToPay,
                    bookedSlots: bookedSlots,
                });
            }
        });

        // logger.info(`${logPrefix} Transaction completed successfully`);
    } catch (e) {
        // logger.error(`${logPrefix} TRANSACTION FAILED: ${e.message}`);
        // logger.error(e.stack);

    }
}


export { initMissedLeadsFunction };
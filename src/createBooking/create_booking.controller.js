import rescheduleBooking from './helper/rescheduleBooking.js';
import { createNewBooking } from './helper/createNewBooking.js';

export async function createBookingHandler(request, reply) {
    const fastify = request.server;
    const body = request.body;

    const {
        bookingData,
        preferredPartner,
        bookingDate,
        rescheduleData,
    } = body;

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    const bookingTs = Date.parse(bookingDate);
    if (Number.isNaN(bookingTs) || bookingTs < todayMidnight.getTime()) {
        return reply.code(400).send({
            message: 'Cannot book for past dates',
        });
    }

    if (rescheduleData?.status === true) {
        const { bookingId, rescheduleSlotNumber } = rescheduleData;

        if (!bookingId || rescheduleSlotNumber == null) {
            return reply.code(400).send({
                message: 'Reschedule requires bookingId and slotNumber',
            });
        }

        const rescheduleStart = process.hrtime.bigint();
        console.log(`\n[RESCHEDULE BOOKING] Flow started at: ${new Date().toISOString()}`);

        const result = await rescheduleBooking(
            fastify,
            preferredPartner,
            bookingDate,
            rescheduleData
        );

        const rescheduleEnd = process.hrtime.bigint();
        const totalDuration = Number(rescheduleEnd - rescheduleStart) / 1_000_000;
        console.log(`[RESCHEDULE BOOKING] ✓ Total flow completed in: ${totalDuration.toFixed(2)}ms (${(totalDuration / 1000).toFixed(2)}s)`);
        console.log(`[RESCHEDULE BOOKING] Status: ${result.status}\n`);

        return reply.code(result.statusCode || 200).send(result);
    }

    /* ---------- NEW BOOKING FLOW ---------- */
    const requiredFields = [
        'bookingsminutes',
        'priceToPay',
        'clientid',
        'latitude',
        'longitude',
    ];

    for (const field of requiredFields) {
        if (bookingData?.[field] == null) {
            return reply.code(400).send({
                message: `Missing field: ${field}`,
            });
        }
    }

    const createBookingStart = process.hrtime.bigint();
    console.log(`\n[CREATE BOOKING] Flow started at: ${new Date().toISOString()}`);

    const result = await createNewBooking(
        fastify,
        bookingData,
        preferredPartner,
        bookingDate
    );

    const createBookingEnd = process.hrtime.bigint();
    const totalDuration = Number(createBookingEnd - createBookingStart) / 1_000_000;
    console.log(`[CREATE BOOKING] ✓ Total flow completed in: ${totalDuration.toFixed(2)}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    console.log(`[CREATE BOOKING] Status: ${result.status}\n`);

    return reply.send(result);
}

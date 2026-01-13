import rescheduleBooking from './helper/rescheduleBooking.js';
import { createNewBooking } from './helper/createNewBooking.js';

export async function createBookingHandler(request, reply) {
    const fastify = request.server; // Access fastify instance
    const { bookingData, preferredPartner, bookingDate, rescheduleData } = request.body;

    // 1. Optimized Date Validation (Compare Timestamps directly - faster than creating Date objects)
    const todayStr = new Date().toISOString().slice(0, 10);
    if (bookingDate < todayStr) {
        return reply.code(400).send({ message: "Cannot book for past dates" });
    }

    // 2. Logic Split: New Booking vs Reschedule
    // We check rescheduleData first as it's a specific condition
    if (rescheduleData && rescheduleData.status === true) {

        // Reschedule Flow
        // Schema validation handled 'minimum/maximum' for slotNumber, so we just check existence
        if (!rescheduleData.bookingId || rescheduleData.rescheduleSlotNumber === undefined) {
            return reply.code(400).send({ message: "Reschedule requires bookingId and slotNumber" });
        }

        // Pass 'reply' if your legacy functions need it, otherwise return data directly
        // Better practice: return await rescheduleBooking(...) and let Fastify send JSON
        return await rescheduleBooking(preferredPartner, bookingDate, rescheduleData, reply);

    } else {

        // New Booking Flow
        // Manual check for required fields inside the nested object
        const requiredFields = ['bookingsminutes', 'priceToPay', 'clientid', 'latitude', 'longitude'];
        const missing = requiredFields.filter(f => !bookingData?.[f]);

        if (missing.length > 0) {
            return reply.code(400).send({ message: `Missing fields: ${missing.join(', ')}` });
        }

        return await createNewBooking(fastify, bookingData, preferredPartner, bookingDate, reply);
    }
};

import { createBookingSchema } from './create_booking_schema.js';
import { createBookingHandler } from './create_booking.controller.js';

export async function createBookingRoutes(fastify, options) {

    fastify.post('/create-booking-fastify', {
        // preHandler: fastify.authenticate,
        schema: createBookingSchema,
        handler: createBookingHandler,
    });
}
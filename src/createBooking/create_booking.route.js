import { createBookingSchema } from './create_booking_schema.js';
import { createBookingHandler } from './create_booking.controller.js';

export async function createBookingRoutes(fastify, options) {

    fastify.post('/create-booking-fastify', {
        schema: createBookingSchema,
        handler: createBookingHandler,
    });
}
import { admin, firestore, GeoFirestore, FieldValue } from "../../../plugin/firebase.js";
import axios from "axios";
// import logger from "../logger.js";
import { checkAPIStatus, getMAPBOXAPIToken, increaseMAPBOXAPIHitCount, increaseMAPBOXAPIHitCountForCreateBooking } from "../helpers.js";

// Function to calculate distance using mapboxAPI
async function calculateDistance(
    partnerLatitude,
    partnerLongitude,
    coordinates
) {
    try {
        const status = await checkAPIStatus();

        const mapboxAccessToken = getMAPBOXAPIToken(status?.MAPBOX_Authorization);
        if (!mapboxAccessToken) {
            const error = new Error("Mapbox Access Token not found");
            // logger.info('Configuration error', {error: error.message});
            throw error;
        }
        const {latitude, longitude} = coordinates;
        const locationCoordinates = `${longitude},${latitude}`;

        const partnerCoordinates = `${partnerLongitude},${partnerLatitude}`;

        const mapboxApiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${partnerCoordinates};${locationCoordinates}`;
        const response = await axios.get(mapboxApiUrl, {
            params: {
                access_token: mapboxAccessToken,
                overview: false,
            },
        });
        if (response.data.routes.length === 0) {
            const error = new Error("No route found in Mapbox API response");
            // logger.info('Validation error', {
            //     error: error.message,
            //     responseData: response.data
            // });
            throw error;
        }
        await increaseMAPBOXAPIHitCount();
        await increaseMAPBOXAPIHitCountForCreateBooking();
        return response.data.routes[0].distance;
    } catch (error) {
        // logger.info({line: 27, error});
    }
}

// Function to fetch number of bookings from firestore database
async function fetchNumberOfBookings(partner, bookingDate) {
    var nextDatefromBooking = new Date(bookingDate);
    nextDatefromBooking.setDate(nextDatefromBooking.getDate() + 1); // Adds one day

    // Fetch number of bookings from firestore database
    const query = firestore
        .collection("BOOKINGS")
        .where("assignedpartnerid", "==", partner.id)
        .where("bookingdateIsoString", ">=", new Date(bookingDate).toISOString())
        .where("bookingdateIsoString", "<", nextDatefromBooking.toISOString())
        .where("status", "in", [
            "pending",
            "confirmed",
            "tripstarted",
            "jobstarted",
            "jobfinished",
            "rated",
        ]);
    const snapshot = await query.get();
    return snapshot.docs.length;
}

// Function to create object for each partner with required key-value pairs
async function reformatPartners(partnersMap, coordinates, bookingDate) {
    const partnerObjects = [];

    for (const partner of partnersMap) {
        const partnerCollection = firestore.collection("partner");
        const partnerDocRef = partnerCollection.doc(partner.id);
        const docSnapshot = await partnerDocRef.get();
        // logger.info({ line: 61, docSnapshot: docSnapshot.data() });

        if (docSnapshot.exists) {
            const {latitude, longitude, rank, avgrating, cancellationRate} = docSnapshot.data();
            const distance = await calculateDistance(
                latitude,
                longitude,
                coordinates
            );
            const numberOfBookings = await fetchNumberOfBookings(
                partner,
                bookingDate
            );

            const partnerObject = {
                id: partner.id,
                distance,
                rank,
                numberOfBookings,
                avgrating,
                cancellationRate: cancellationRate ?? 0
            };

            partnerObjects.push(partnerObject);
        } else {}
            // logger.info("No such Document Exists of Partner");
    }

    return partnerObjects;
}

export default reformatPartners;

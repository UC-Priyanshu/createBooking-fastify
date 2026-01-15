
// function increaseAPIHitCount() {
//     return firestore
//         .collection("Configurations")
//         .doc("DistanceAPI")
//         .update({
//             API_Hit_Count: FieldValue.increment(1),
//         });
// }

// function changeAPIStatus(status) {
//     return firestore.collection("Configurations").doc("DistanceAPI").update({
//         status,
//     });
// }


// function generateRoundedCoordinates(latitude, longitude) {
//     const roundedLatitude = parseFloat(latitude.toFixed(4));
//     const roundedLongitude = parseFloat(longitude.toFixed(4));
//     return {roundedLatitude, roundedLongitude};
// }

async function checkAPIStatus(fastify) {
    const { firestore } = fastify.firebase;
    return await firestore
        .collection("Configurations")
        .doc("DistanceAPI")
        .get()
        .then((doc) => {
            if (doc.exists && doc.data().status) {
                return {
                    BearerToken: doc.data().Authorization,
                    Appversion: doc.data().App_Version,
                    MAPBOX_Authorization: doc.data().MAPBOX_Authorization,
                    MAPBOX_status: doc.data().MAPBOX_status
                };
            } else if (doc.exists && doc.data().MAPBOX_status === true) {
                return {
                    BearerToken: doc.data().Authorization,
                    Appversion: doc.data().App_Version,
                    MAPBOX_Authorization: doc.data().MAPBOX_Authorization,
                    MAPBOX_status: doc.data().MAPBOX_status
                };
            }
            return false;
        })
        .catch((error) => {
            // logger.info({line: 120, error});
            return true; 
        });
}

// function generateSpecialID(sourceGeoHash, destinationGeoHash) {
//     return sourceGeoHash + destinationGeoHash;
// }

async function increaseMAPBOXAPIHitCount() {
    await firestore
        .collection("Configurations")
        .doc("DistanceAPI")
        .update({
            MAPBOX_API_Hit_Count: FieldValue.increment(1),
        });
}

async function increaseMAPBOXAPIHitCountForCreateBooking() {
    await firestore
        .collection("Configurations")
        .doc("DistanceAPI")
        .update({
            MAPBOX_API_Hit_Count_By_CreateBooking: FieldValue.increment(1),
        });
}

// function changeMAPBOXAPIStatus(status) {
//     return firestore.collection("Configurations").doc("DistanceAPI").update({
//         MAPBOX_status: status,
//     });
// }


function getMAPBOXAPIToken(MAPBOX_Authorization) {
    let authTokenObjList = MAPBOX_Authorization;

    authTokenObjList = authTokenObjList.filter((obj) => obj.active === true);

    if (authTokenObjList.length === 0) return false;

    const randomIndex = Math.floor(Math.random() * authTokenObjList.length);

    return authTokenObjList[randomIndex].token;
}

export {
    // increaseAPIHitCount,
    // changeAPIStatus,
    // generateRoundedCoordinates,
    checkAPIStatus,
    // generateSpecialID,
    increaseMAPBOXAPIHitCount,
    // changeMAPBOXAPIStatus,
    getMAPBOXAPIToken,
    increaseMAPBOXAPIHitCountForCreateBooking
};
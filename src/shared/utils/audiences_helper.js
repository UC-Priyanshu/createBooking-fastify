import crypto from 'crypto';

// Keep logger import present but commented, per request.
// import logger from "./logger.js";

const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';

function sha256Hash(value) {
	return crypto
		.createHash('sha256')
		.update(String(value ?? '').trim().toLowerCase())
		.digest('hex');
}

async function getFacebookSdk() {
	// Lazy-load so the server can boot even if the dependency is missing.
	const mod = await import('facebook-nodejs-business-sdk');
	return mod?.default ?? mod;
}

async function withAudience(audienceId, callback) {
	const bizSdk = await getFacebookSdk();
	if (!ACCESS_TOKEN) {
		throw new Error('ACCESS_TOKEN is not set for Facebook SDK');
	}

	bizSdk.FacebookAdsApi.init(ACCESS_TOKEN);
	const CustomAudience = bizSdk.CustomAudience;
	const audience = new CustomAudience(audienceId);
	return callback(audience);
}

function toUsersData(users) {
	return (users || []).map((user) => [
		sha256Hash(user?.email),
		sha256Hash((user?.name || '').trim().toLowerCase().split(' ')[0] || ''),
		sha256Hash((user?.name || '').trim().toLowerCase().split(' ')[1] || ''),
		sha256Hash((user?.phoneNumber || '').replace(/\s+/g, '')),
		sha256Hash((user?.userAddresses?.[0]?.city || '').toLowerCase()),
		sha256Hash((user?.userAddresses?.[0]?.state || '').toLowerCase()),
		sha256Hash((user?.userAddresses?.[0]?.country || '').substring(0, 2).toLowerCase()),
		sha256Hash(user?.gender === 'Male' ? 'm' : user?.gender === 'Female' ? 'f' : ''),
		sha256Hash(user?.zip || ''),
		sha256Hash(user?.adInfo?.advertisingId || ''),
	]);
}

// Keep signature compatible with existing calls: (fastify, audienceId, users)
async function addUsersToAudience(_fastify, audienceId, users) {
	const usersData = toUsersData(users);
	return withAudience(audienceId, (audience) =>
		audience.createUser([], {
			payload: {
				schema: ['EMAIL', 'FN', 'LN', 'PHONE', 'CT', 'ST', 'COUNTRY', 'GEN', 'ZIP', 'MADID'],
				data: usersData,
			},
		})
	);
}

async function removeUsersFromAudience(_fastify, audienceId, users) {
	const usersData = toUsersData(users);
	return withAudience(audienceId, (audience) =>
		audience.deleteUsers({
			payload: {
				schema: ['EMAIL', 'FN', 'LN', 'PHONE', 'CT', 'ST', 'COUNTRY', 'GEN', 'ZIP', 'MADID'],
				data: usersData,
			},
		})
	);
}

async function replaceUsersInAudience(_fastify, audienceId, users) {
	const usersData = toUsersData(users);
	return withAudience(audienceId, (audience) =>
		audience.createUsersReplace([], {
			payload: {
				schema: ['EMAIL', 'FN', 'LN', 'PHONE', 'CT', 'ST', 'COUNTRY', 'GEN', 'ZIP', 'MADID'],
				data: usersData,
			},
		})
	);
}

export { addUsersToAudience, removeUsersFromAudience, replaceUsersInAudience };
// Test phones: '+99899' + 7 digits from a Redis counter shared by all test
// files of a run. The global setup starts the counter above every phone
// already stored, so the (non-wiped) test database never sees a duplicate.
// Demo users (isDemo: true) take phones from the same sequence: demo status
// is the isDemo flag, and the reserved +998000000NNN range (999 numbers)
// belongs to the demo seed.
export const PHONE_PREFIX = '+99899';
export const PHONE_SEQUENCE_KEY = 'test:seq:phone';

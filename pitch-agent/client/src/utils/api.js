import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

// Fixtures
export const getFixtures = (params) => api.get('/fixtures', { params });
export const scrapeFixtures = () => api.post('/fixtures/scrape');
export const getScrapeStatus = () => api.get('/fixtures/scrape/status');
export const importFixtures = (fixtures) => api.post('/fixtures/import', { fixtures });

// Allocations
export const getAllocationGrid = (week) => api.get('/allocations/grid', { params: { week } });
export const generateAllocations = (week) => api.post('/allocations/generate', { week });
export const updateAllocation = (id, data) => api.put(`/allocations/${id}`, data);
export const deleteAllocation = (id) => api.delete(`/allocations/${id}`);
export const confirmAllocations = (week) => api.post('/allocations/confirm', { week });
export const publishAllocations = (week) => api.post('/allocations/publish', { week });
export const getAllocationSummary = (week) => api.get('/allocations/summary', { params: { week } });

// Referees
export const getReferees = () => api.get('/referees');
export const addReferee = (data) => api.post('/referees', data);
export const updateReferee = (id, data) => api.put(`/referees/${id}`, data);
export const claimMatch = (allocation_id, referee_id) => api.post('/referees/claim', { allocation_id, referee_id });
export const unclaimMatch = (allocationId) => api.delete(`/referees/claim/${allocationId}`);
export const getAvailableRefs = (date) => api.get('/referees/available', { params: { date } });

// Venues
export const getVenues = () => api.get('/venues');

// Requests
export const getRequests = (status) => api.get('/requests', { params: { status } });
export const submitRequest = (data) => api.post('/requests', data);
export const updateRequest = (id, data) => api.put(`/requests/${id}`, data);

export default api;

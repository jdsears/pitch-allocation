import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

// --- Admin auth ---
// Token from POST /auth/login, kept in localStorage and sent on every call.
const TOKEN_KEY = 'morley_admin_token';
export const getAdminToken = () => localStorage.getItem(TOKEN_KEY);
export const setAdminToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
api.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const adminLogin = (password) => api.post('/auth/login', { password });
export const getAuthStatus = () => api.get('/auth/status');

// Fixtures
export const getFixtures = (params) => api.get('/fixtures', { params });
export const scrapeFixtures = () => api.post('/fixtures/scrape');
export const getScrapeStatus = () => api.get('/fixtures/scrape-status');
export const updateFixture = (id, data) => api.put(`/fixtures/${id}`, data);
export const deleteFixture = (id) => api.delete(`/fixtures/${id}`);
export const importFixtures = (fixtures) => api.post('/fixtures/import', { fixtures });
export const importFixtureImage = (file, gender) => {
  const formData = new FormData();
  formData.append('image', file);
  if (gender) formData.append('gender', gender);
  return api.post('/fixtures/import-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
};

// Allocations
export const getAllocationGrid = (week) => api.get('/allocations/grid', { params: { week } });
export const getAllocationOverview = (week, weeks = 4) => api.get('/allocations/overview', { params: { week, weeks } });
export const generateAllocations = (week) => api.post('/allocations/generate', { week });
export const updateAllocation = (id, data) => api.put(`/allocations/${id}`, data);
export const deleteAllocation = (id) => api.delete(`/allocations/${id}`);
export const confirmAllocations = (week) => api.post('/allocations/confirm', { week });
export const publishAllocations = (week) => api.post('/allocations/publish', { week });
export const getOverviewMessage = (week, weeks = 4) => api.post('/allocations/overview-message', { week, weeks });
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

// Calendar
export const getCalendar = (week, weeks = 4) => api.get('/allocations/calendar', { params: { week, weeks } });

// Teams
// Distinct team-name list pulled from fixtures — used by the calendar filter.
export const getTeams = () => api.get('/fixtures/teams');

// Managed team records (CRUD + season tools)
export const listTeams = (activeOnly) => api.get('/teams', { params: activeOnly ? { active: 'true' } : {} });
export const addTeam = (data) => api.post('/teams', data);
export const updateTeam = (id, data) => api.put(`/teams/${id}`, data);
export const deleteTeam = (id) => api.delete(`/teams/${id}`);
export const syncTeamsFromFixtures = () => api.post('/teams/sync-from-fixtures');
export const getRolloverPreview = () => api.get('/teams/rollover/preview');
export const applyRollover = () => api.post('/teams/rollover/apply');

export default api;

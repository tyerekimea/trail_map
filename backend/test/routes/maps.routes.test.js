const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

const mapsRoutes = require('../../src/routes/maps');

describe('maps routes', () => {
  let app;
  const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    app = express();
    app.use('/api/maps', mapsRoutes);
    axios.get.mockReset();
  });

  afterEach(() => {
    if (originalMapsKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
    }
  });

  test('GET /api/maps/autocomplete returns 500 when API key is missing', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;

    const response = await request(app).get('/api/maps/autocomplete').query({
      input: 'ab',
      country: 'ng',
    });

    expect(response.status).toBe(500);
    expect(response.body.status).toBe('REQUEST_DENIED');
  });

  test('GET /api/maps/autocomplete validates short input', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'fake-maps-key';

    const response = await request(app).get('/api/maps/autocomplete').query({
      input: 'a',
      country: 'ng',
    });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe('INVALID_REQUEST');
  });

  test('GET /api/maps/autocomplete proxies successful upstream response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'fake-maps-key';
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        status: 'OK',
        predictions: [],
      },
    });

    const response = await request(app).get('/api/maps/autocomplete').query({
      input: 'ab',
      country: 'ng',
      types: 'geocode|establishment',
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      expect.objectContaining({
        timeout: 15000,
        params: expect.objectContaining({
          input: 'ab',
          components: 'country:ng',
          types: 'geocode|establishment',
          key: 'fake-maps-key',
        }),
      })
    );
  });

  test('GET /api/maps/autocomplete returns 502 on upstream network failure', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'fake-maps-key';
    axios.get.mockRejectedValue(new Error('network down'));

    const response = await request(app).get('/api/maps/autocomplete').query({
      input: 'ab',
      country: 'ng',
    });

    expect(response.status).toBe(502);
    expect(response.body.status).toBe('REQUEST_FAILED');
  });
});

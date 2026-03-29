const errorHandler = require('../src/middleware/errorHandler');

const createRes = () => {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  return res;
};

describe('errorHandler middleware', () => {
  const req = {};
  const next = jest.fn();
  const originalNodeEnv = process.env.NODE_ENV;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('returns 401 for JsonWebTokenError', () => {
    const res = createRes();
    const err = { name: 'JsonWebTokenError', stack: 'stack' };

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Invalid token',
    });
  });

  test('returns 403 for disallowed CORS origin', () => {
    const res = createRes();
    const err = { message: 'CORS origin is not allowed', stack: 'stack' };

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      success: false,
      message: 'CORS origin is not allowed',
    });
  });

  test('returns 400 for duplicate key errors', () => {
    const res = createRes();
    const err = {
      code: 11000,
      keyPattern: { email: 1 },
      stack: 'stack',
    };

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({
      success: false,
      message: 'email already exists',
    });
  });

  test('returns default 500 and includes stack in development', () => {
    process.env.NODE_ENV = 'development';
    const res = createRes();
    const err = {
      message: 'Unexpected failure',
      stack: 'trace goes here',
    };

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body).toEqual({
      success: false,
      message: 'Unexpected failure',
      stack: 'trace goes here',
    });
  });
});

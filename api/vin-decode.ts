import type { VercelRequest, VercelResponse } from '@vercel/node';

// NHTSA Vehicle Product Information Catalog (vPIC) API
// Free, no auth required: https://vpic.nhtsa.dot.gov/api/
const NHTSA_API_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

interface NHTSAResult {
  Variable: string;
  Value: string | null;
  ValueId: string | null;
}

interface NHTSAResponse {
  Count: number;
  Message: string;
  SearchCriteria: string;
  Results: NHTSAResult[];
}

interface DecodedVehicle {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  driveType: string | null;
  engineCylinders: number | null;
  engineDisplacementL: number | null;
  fuelType: string | null;
  transmissionStyle: string | null;
  plantCity: string | null;
  plantCountry: string | null;
  manufacturerName: string | null;
  vehicleType: string | null;
  errorCode: string | null;
  errorText: string | null;
  raw?: NHTSAResult[];
}

// Map NHTSA variable names to our output fields
const FIELD_MAPPINGS: Record<string, keyof DecodedVehicle> = {
  'Model Year': 'year',
  'Make': 'make',
  'Model': 'model',
  'Trim': 'trim',
  'Body Class': 'bodyClass',
  'Drive Type': 'driveType',
  'Engine Number of Cylinders': 'engineCylinders',
  'Displacement (L)': 'engineDisplacementL',
  'Fuel Type - Primary': 'fuelType',
  'Transmission Style': 'transmissionStyle',
  'Plant City': 'plantCity',
  'Plant Country': 'plantCountry',
  'Manufacturer Name': 'manufacturerName',
  'Vehicle Type': 'vehicleType',
  'Error Code': 'errorCode',
  'Error Text': 'errorText',
};

function validateVIN(vin: string): { valid: boolean; error?: string } {
  if (!vin) {
    return { valid: false, error: 'VIN is required' };
  }

  // Remove spaces and convert to uppercase
  const cleanVIN = vin.replace(/\s/g, '').toUpperCase();

  // VIN should be exactly 17 characters
  if (cleanVIN.length !== 17) {
    return { valid: false, error: `VIN must be 17 characters (got ${cleanVIN.length})` };
  }

  // VIN should not contain I, O, or Q (easily confused with 1, 0)
  if (/[IOQ]/.test(cleanVIN)) {
    return { valid: false, error: 'VIN cannot contain letters I, O, or Q' };
  }

  // VIN should only contain alphanumeric characters
  if (!/^[A-HJ-NPR-Z0-9]+$/.test(cleanVIN)) {
    return { valid: false, error: 'VIN contains invalid characters' };
  }

  return { valid: true };
}

async function decodeVIN(vin: string): Promise<DecodedVehicle> {
  const cleanVIN = vin.replace(/\s/g, '').toUpperCase();

  const response = await fetch(`${NHTSA_API_BASE}/DecodeVin/${cleanVIN}?format=json`);

  if (!response.ok) {
    throw new Error(`NHTSA API error: ${response.status} ${response.statusText}`);
  }

  const data: NHTSAResponse = await response.json();

  // Initialize decoded vehicle with nulls
  const decoded: DecodedVehicle = {
    vin: cleanVIN,
    year: null,
    make: null,
    model: null,
    trim: null,
    bodyClass: null,
    driveType: null,
    engineCylinders: null,
    engineDisplacementL: null,
    fuelType: null,
    transmissionStyle: null,
    plantCity: null,
    plantCountry: null,
    manufacturerName: null,
    vehicleType: null,
    errorCode: null,
    errorText: null,
  };

  // Extract values from NHTSA response
  for (const result of data.Results) {
    const fieldName = FIELD_MAPPINGS[result.Variable];
    if (fieldName && result.Value) {
      const value = result.Value.trim();
      if (value && value !== 'Not Applicable') {
        // Handle numeric fields
        if (fieldName === 'year' || fieldName === 'engineCylinders') {
          const num = parseInt(value, 10);
          if (!isNaN(num)) {
            (decoded as any)[fieldName] = num;
          }
        } else if (fieldName === 'engineDisplacementL') {
          const num = parseFloat(value);
          if (!isNaN(num)) {
            decoded.engineDisplacementL = num;
          }
        } else {
          (decoded as any)[fieldName] = value;
        }
      }
    }
  }

  return decoded;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get VIN from query or body
    const vin = (req.query.vin as string) || (req.body?.vin as string);
    const includeRaw = req.query.raw === 'true' || req.body?.raw === true;

    if (!vin) {
      return res.status(400).json({
        error: 'Missing VIN parameter',
        usage: {
          GET: '/api/vin-decode?vin=1HGBH41JXMN109186',
          POST: '{ "vin": "1HGBH41JXMN109186" }',
        },
        example: {
          sampleVIN: '1HGBH41JXMN109186',
          description: 'Use a 17-character VIN to decode vehicle information',
        },
      });
    }

    // Validate VIN format
    const validation = validateVIN(vin);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid VIN format',
        details: validation.error,
        providedVIN: vin,
      });
    }

    // Decode VIN via NHTSA API
    const decoded = await decodeVIN(vin);

    // Check for NHTSA errors (error code 0 means success)
    if (decoded.errorCode && decoded.errorCode !== '0') {
      return res.status(200).json({
        success: false,
        error: decoded.errorText || 'VIN decode error',
        errorCode: decoded.errorCode,
        vin: decoded.vin,
      });
    }

    // Return decoded vehicle info
    const response: any = {
      success: true,
      vehicle: {
        vin: decoded.vin,
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        bodyClass: decoded.bodyClass,
        driveType: decoded.driveType,
        engine: {
          cylinders: decoded.engineCylinders,
          displacementL: decoded.engineDisplacementL,
          fuelType: decoded.fuelType,
        },
        transmission: decoded.transmissionStyle,
        manufacturer: decoded.manufacturerName,
        vehicleType: decoded.vehicleType,
        plant: {
          city: decoded.plantCity,
          country: decoded.plantCountry,
        },
      },
      source: 'NHTSA vPIC API',
    };

    // Optionally include raw NHTSA response
    if (includeRaw) {
      response.raw = decoded.raw;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('VIN decode error:', error);
    return res.status(500).json({
      error: 'Failed to decode VIN',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

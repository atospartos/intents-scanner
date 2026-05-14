import 'dotenv/config';
import { getNearIntentsSigner, NearSignerContext } from './near-config';

export const getSigner = async (): Promise< NearSignerContext > => {
  if (process.env.PRIVATE_KEY_NEAR) {
    return await getNearIntentsSigner();
  }
  throw new Error(
    'PRIVATE_KEY_NEAR is not set',
  );
};

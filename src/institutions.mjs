// Every branch of government plugs in here, in constitutional order.
import { institution as president } from './president.mjs';
import { institution as council } from './council.mjs';

export const INSTITUTIONS = [president, council];

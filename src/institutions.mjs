// Every branch of government plugs in here, in constitutional order.
import { institution as president } from './president.mjs';
import { institution as council } from './council.mjs';
import { institution as police } from './police.mjs';

export const INSTITUTIONS = [president, council, police];

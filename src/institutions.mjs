// Every branch of government plugs in here, in constitutional order.
import { institution as president } from './president.mjs';
import { institution as council } from './council.mjs';
import { institution as police } from './police.mjs';
import { institution as military } from './military.mjs';
import { institution as training } from './training.mjs';

export const INSTITUTIONS = [president, council, police, military, training];

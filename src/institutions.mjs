// Every branch of government plugs in here, in constitutional order.
import { institution as president } from './president.mjs';
import { institution as council } from './council.mjs';
import { institution as police } from './police.mjs';
import { institution as military } from './military.mjs';
import { institution as command } from './command.mjs';
import { institution as elections } from './elections.mjs';
import { institution as court } from './court.mjs';
import { institution as audit } from './auditoffice.mjs';
import { institution as cities } from './cities.mjs';
import { institution as careers } from './careers.mjs';
import { institution as training } from './training.mjs';

export const INSTITUTIONS = [president, council, police, military, command, elections, court, audit, cities, careers, training];

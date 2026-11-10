// Every branch of government plugs in here, in constitutional order.
import { institution as president } from './president.ts';
import { institution as council } from './council.ts';
import { institution as police } from './police.ts';
import { institution as military } from './military.ts';
import { institution as command } from './command.ts';
import { institution as elections } from './elections.ts';
import { institution as court } from './court.ts';
import { institution as audit } from './auditoffice.ts';
import { institution as cities } from './cities.ts';
import { institution as careers } from './careers.ts';
import { institution as training } from './training.ts';
import { institution as underworld } from './underworld.ts';

export const INSTITUTIONS = [president, council, police, military, command, elections, court, audit, cities, careers, training, underworld];

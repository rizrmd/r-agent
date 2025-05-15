import dotenv from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { BaseTelemetryEvent } from './views';
import { Logger } from '../utils';

dotenv.config();

const logger = new Logger('telemetry');

const POSTHOG_EVENT_SETTINGS = {
  process_person_profile: true,
};

class PostHog {
  capture(event: any) {
    console.info('Capturing event:', event);
  }
}

export class ProductTelemetry {
  private static instance: ProductTelemetry;
  private readonly USER_ID_PATH: string;
  private _curr_user_id: string | null = null;
  private _posthog_client: PostHog | null;
  private debug_logging: boolean;

  constructor() {
    this.USER_ID_PATH = join(homedir(), '.cache', 'browser_use', 'telemetry_user_id');
    const telemetry_disabled = true;
    this.debug_logging = process.env.BROWSER_USE_LOGGING_LEVEL?.toLowerCase() === 'debug';

    if (telemetry_disabled) {
      this._posthog_client = null;
    }
    else {
      this._posthog_client = new PostHog();
    }

    if (this._posthog_client == null) {
      logger.debug('Telemetry disabled');
    }
  }

  public static getInstance(): ProductTelemetry {
    if (!ProductTelemetry.instance) {
      ProductTelemetry.instance = new ProductTelemetry();
    }
    return ProductTelemetry.instance;
  }

  public capture(event: BaseTelemetryEvent): void {
    if (this._posthog_client == null) {
      return;
    }

    if (this.debug_logging) {
      logger.debug(`Telemetry event: ${event.name} ${JSON.stringify(event.properties)}`);
    }
    this._direct_capture(event);
  }

  private _direct_capture(event: BaseTelemetryEvent): void {
    if (this._posthog_client == null) {
      return;
    }

    try {
      this._posthog_client.capture({
        distinctId: this.user_id,
        event: event.name,
        properties: { ...event.properties, ...POSTHOG_EVENT_SETTINGS },
      });
    } catch (e) {
      logger.error(`Failed to send telemetry event ${event.name}: ${e}`);
    }
  }

  public get user_id(): string {
    if (this._curr_user_id) {
      return this._curr_user_id;
    }

    try {
      if (!existsSync(this.USER_ID_PATH)) {
        mkdirSync(join(homedir(), '.cache', 'browser_use'), { recursive: true });
        const new_user_id = uuidv4();
        writeFileSync(this.USER_ID_PATH, new_user_id);
        this._curr_user_id = new_user_id;
      } else {
        this._curr_user_id = readFileSync(this.USER_ID_PATH, 'utf-8');
      }
    } catch (error) {
      this._curr_user_id = 'UNKNOWN_USER_ID';
    }
    return this._curr_user_id;
  }
}
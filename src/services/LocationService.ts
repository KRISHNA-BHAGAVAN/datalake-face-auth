import * as Location from 'expo-location';
import { LocationData } from '../types';
import { logger } from '../utils/logger';

export class LocationService {
  private static cachedLocation: LocationData | null = null;
  private static permissionGranted: boolean | null = null;

  /**
   * Requests foreground location permission.
   */
  static async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      this.permissionGranted = status === 'granted';
      return this.permissionGranted;
    } catch (e) {
      logger.warn('Failed to request location permissions', e);
      return false;
    }
  }

  /**
   * Fast, non-blocking fetch of GPS position.
   * Returns cached/last-known position instantly if available, then updates in background.
   */
  static async getGeotag(): Promise<LocationData | null> {
    try {
      if (this.permissionGranted === null) {
        const ok = await this.requestPermissions();
        if (!ok) return null;
      } else if (!this.permissionGranted) {
        return null;
      }

      // 1. Try instant last-known position (0ms delay)
      const lastKnown = await Location.getLastKnownPositionAsync({});
      if (lastKnown) {
        this.cachedLocation = {
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy ?? 0,
          timestamp: lastKnown.timestamp,
        };
      }

      // 2. Fetch fresh GPS position in background
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      this.cachedLocation = {
        latitude: fresh.coords.latitude,
        longitude: fresh.coords.longitude,
        accuracy: fresh.coords.accuracy ?? 0,
        timestamp: fresh.timestamp,
      };

      return this.cachedLocation;
    } catch (e) {
      logger.warn('Failed to fetch GPS geotag', e);
      return this.cachedLocation;
    }
  }
}

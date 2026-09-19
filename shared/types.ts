export type AppointmentStatus = "CONFIRMED" | "CANCELLED";
export interface Service {
  _id: string;
  name: string;
  durationMinutes: number;
  priceFen: number;
  status: "ACTIVE" | "INACTIVE";
  version: number;
}
export interface Interval {
  appointmentId: string;
  startTime: number;
  endTime: number;
}
export interface Day {
  manuallyClosed?: boolean;
  _id: string;
  resourceId: string;
  localDate: string;
  windows: { startTime: number; endTime: number }[];
  blockedIntervals: { startTime: number; endTime: number }[];
  intervals: Interval[];
  revision: number;
  configVersion: number;
}
export interface Appointment {
  _id: string;
  userId: string;
  serviceId: string;
  serviceName: string;
  resourceId: string;
  localDate: string;
  startTime: number;
  endTime: number;
  durationMinutes: number;
  priceFen: number;
  status: AppointmentStatus;
  idempotencyId: string;
  createdAt: number;
  updatedAt: number;
}
export type PublicAppointment = Omit<
  Appointment,
  "userId" | "idempotencyId" | "resourceId"
>;
export interface Result<T = unknown> {
  code: string;
  data: T | null;
  requestId: string;
  retryAfterSeconds?: number;
}
export interface Availability {
  slots: { startTime: number; label: string }[];
  revision: number;
  date: string;
  durationMinutes: number;
  priceFen: number;
}

import { IsObject, IsString, MaxLength } from 'class-validator';

export class SubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };
}

export class UnsubscribeDto {
  @IsString()
  @MaxLength(1000)
  endpoint!: string;
}

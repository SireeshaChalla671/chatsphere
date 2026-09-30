import { IsString, Length, MinLength } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @MinLength(5)
  identifier!: string; // email or phone number
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(5)
  identifier!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
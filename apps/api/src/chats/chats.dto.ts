import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDirectDto {
  @IsString()
  userId!: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  replyToId?: string;
}

import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(700)
  body?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  bgColor?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType?: string;
}

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Initialize transporter
let transporter = null;

const initializeTransporter = () => {
  if (transporter) return transporter;

  const config = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  };

  transporter = nodemailer.createTransport(config);
  return transporter;
};

/**
 * Send password reset email
 * @param {string} email - User email
 * @param {string} resetToken - Reset token
 * @param {string} resetUrl - Full reset URL to send in email
 * @returns {Promise<boolean>}
 */
const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: 'Password Reset Request - Trail Map',
      html: `
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your Trail Map account.</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Reset Password
        </a>
        <p>Or copy and paste this URL in your browser:</p>
        <p>${resetUrl}</p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request a password reset, please ignore this email.</p>
        <hr>
        <p><small>Trail Map Application</small></p>
      `,
      text: `
        Password Reset Request
        
        You requested a password reset for your Trail Map account.
        
        Click the link below to reset your password:
        ${resetUrl}
        
        This link will expire in 1 hour.
        
        If you didn't request a password reset, please ignore this email.
        
        Trail Map Application
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info('Password reset email sent', { email, messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error('Failed to send password reset email', { email, error });
    return false;
  }
};

/**
 * Send account verification email
 * @param {string} email - User email
 * @param {string} verificationUrl - Full verification URL
 * @returns {Promise<boolean>}
 */
const sendVerificationEmail = async (email, verificationUrl) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: 'Verify Your Email - Trail Map',
      html: `
        <h2>Email Verification Required</h2>
        <p>Welcome to Trail Map! Please verify your email address to complete your account setup.</p>
        <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Verify Email
        </a>
        <p>Or copy and paste this URL:</p>
        <p>${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <hr>
        <p><small>Trail Map Application</small></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info('Verification email sent', { email, messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error('Failed to send verification email', { email, error });
    return false;
  }
};

/**
 * Send account deletion confirmation email
 * @param {string} email - User email
 * @returns {Promise<boolean>}
 */
const sendAccountDeletionConfirmationEmail = async (email) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject: 'Account Deleted - Trail Map',
      html: `
        <h2>Account Deletion Confirmed</h2>
        <p>Your Trail Map account has been successfully deleted.</p>
        <p>All your personal data, including saved places and settings, have been permanently removed from our servers.</p>
        <p>If you have questions, please contact our support team.</p>
        <hr>
        <p><small>Trail Map Application</small></p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info('Account deletion email sent', { email, messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error('Failed to send account deletion email', { email, error });
    return false;
  }
};

/**
 * Check if email service is configured
 * @returns {boolean}
 */
const isEmailConfigured = () => {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );
};

module.exports = {
  initializeTransporter,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendAccountDeletionConfirmationEmail,
  isEmailConfigured
};

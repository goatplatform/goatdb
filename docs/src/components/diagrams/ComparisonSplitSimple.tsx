import React from 'react';

interface ComparisonProps {
  title: string;
  traditional: {
    label: string;
    items: string[];
    complexity: 'low' | 'medium' | 'high';
  };
  goatdb: {
    label: string;
    items: string[];
    complexity: 'low' | 'medium' | 'high';
  };
}

export default function ComparisonSplitSimple({ title, traditional, goatdb }: ComparisonProps) {
  const containerStyle: React.CSSProperties = {
    margin: '2rem 0',
  };
  
  const titleStyle: React.CSSProperties = {
    textAlign: 'center',
    marginBottom: '1.5rem',
    fontSize: '1.3rem',
    fontWeight: 600,
  };
  
  const splitContainerStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
  };
  
  const panelStyle = (type: 'traditional' | 'goatdb'): React.CSSProperties => ({
    padding: '1.5rem',
    border: `2px solid var(--ifm-color-${type === 'traditional' ? 'danger' : 'success'}-lighter)`,
    borderRadius: 'var(--ifm-global-radius)',
    background: 'var(--ifm-background-surface-color)',
  });
  
  const panelHeaderStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid var(--ifm-color-emphasis-200)',
  };
  
  const labelStyle: React.CSSProperties = {
    fontSize: '1.1rem',
    fontWeight: 600,
  };
  
  const getComplexityStyle = (complexity: string): React.CSSProperties => {
    const colors = {
      high: { bg: 'var(--ifm-color-danger-lightest)', text: 'var(--ifm-color-danger-darkest)' },
      medium: { bg: 'var(--ifm-color-warning-lightest)', text: 'var(--ifm-color-warning-darkest)' },
      low: { bg: 'var(--ifm-color-success-lightest)', text: 'var(--ifm-color-success-darkest)' },
    };
    const color = colors[complexity as keyof typeof colors];
    return {
      fontSize: '0.75rem',
      padding: '0.25rem 0.5rem',
      borderRadius: 'var(--ifm-global-radius)',
      background: color.bg,
      color: color.text,
    };
  };
  
  const itemsStyle: React.CSSProperties = {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  };
  
  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    marginBottom: '0.75rem',
    fontSize: '0.95rem',
    minHeight: '2.5rem',
    lineHeight: '1.4',
  };


  const descStyle: React.CSSProperties = {
    marginTop: "1rem",
  };
  
  const bulletStyle = (type: 'traditional' | 'goatdb'): React.CSSProperties => ({
    marginRight: '0.5rem',
    fontWeight: 'bold',
    fontSize: '1.2rem',
    color: type === 'traditional' ? 'var(--ifm-color-danger)' : 'var(--ifm-color-success)',
    position: 'relative',
    bottom: "4px",
  });
  
  // Mobile responsive style
  const mobileStyle = `
    @media (max-width: 768px) {
      .comparison-grid {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  
  return (
    <div style={containerStyle} aria-label={`${title} comparison`}>
      <style>{mobileStyle}</style>
      <h3 style={titleStyle}>{title}</h3>
      
      <div className="comparison-grid" style={splitContainerStyle}>
        {/* Traditional Approach */}
        <div style={panelStyle('traditional')}>
          <div style={panelHeaderStyle}>
            <span style={labelStyle}>{traditional.label}</span>
            <span style={getComplexityStyle(traditional.complexity)}>
              Complexity: {traditional.complexity}
            </span>
          </div>
          <ul style={itemsStyle}>
            {traditional.items.map((item, index) => (
              <li key={index} style={itemStyle}>
                <span style={bulletStyle('traditional')}>×</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        
        {/* GoatDB Approach */}
        <div style={panelStyle('goatdb')}>
          <div style={panelHeaderStyle}>
            <span style={labelStyle}>{goatdb.label}</span>
            <span style={getComplexityStyle(goatdb.complexity)}>
              Complexity: {goatdb.complexity}
            </span>
          </div>
          <ul style={itemsStyle}>
            {goatdb.items.map((item, index) => (
              <li key={index} style={itemStyle}>
                <span style={bulletStyle('goatdb')}>•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      
      {/* SEO description */}
      <div className="sr-only" style={{...descStyle, position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0}}>
        Comparison of {title} between traditional approach and GoatDB approach.
        Traditional approach has {traditional.complexity} complexity with challenges including {traditional.items.join(', ')}.
        GoatDB approach has {goatdb.complexity} complexity with benefits including {goatdb.items.join(', ')}.
      </div>
    </div>
  );
}